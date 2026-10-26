import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { openMessageStore } from "../lib/message-store.mjs";
import { legacyPresets } from "../lib/legacy-presets.mjs";
import { badWord } from "../lib/badwords.js";

const normalize = value => value.normalize("NFC").replace(/\s+/g, " ").trim();

export async function replenish({
  path = process.env.MANDRAGORA_MESSAGES_DB,
  fetcher = fetch,
  key = process.env.GROQ_API_KEY,
  model = process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
  now = Date.now(),
} = {}) {
  const db = openMessageStore(path);
  const count = () => Number(db.prepare("SELECT count(*) AS n FROM messages").get().n);
  const minimum = 30, target = 50;
  try {
    db.exec("BEGIN IMMEDIATE");
    const before = count();
    const last = db.prepare("SELECT last_started FROM ai_generation WHERE id = 1").get();
    if (before >= minimum || (last && now - Number(last.last_started) < 3_600_000)) {
      db.exec("ROLLBACK");
      return { status: "skipped", before, added: 0 };
    }
    if (!key) throw new Error("GROQ_API_KEY is not configured");
    db.prepare("INSERT INTO ai_generation (id, last_started) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_started = excluded.last_started").run(now);
    db.exec("COMMIT");

    const seen = new Set(db.prepare("SELECT text FROM messages").all().map(row => normalize(String(row.text))));
    const excluded = new Set(legacyPresets.map(normalize));
    let added = 0;
    // Three bounded requests at most per hour, including failed attempts.
    for (let attempt = 0; attempt < 3 && count() < target; attempt++) {
      const needed = target - count();
      const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0.95, max_completion_tokens: 4096,
          messages: [
            { role: "system", content: "만드라고라를 뽑으면 외치는 짧은 한국어 한마디를 만든다. 일상의 소소한 투정, 엉뚱한 상상, 귀여운 허세, 가벼운 농담을 다양하게 섞는다. 말투와 소재가 겹치지 않게 하고 한 문장은 5~60자로 쓴다. 욕설, 혐오, 성적 표현, 개인정보, 광고, 정치, 자해, 상대 비하를 넣지 않는다. 설명, 번호, 따옴표 장식, AI 언급, 뻔한 위로 문구를 넣지 않는다. JSON 객체의 messages 배열로만 응답한다." },
            { role: "user", content: `서로 다른 한마디 ${needed}개를 만들어줘.` },
          ],
          response_format: { type: "json_schema", json_schema: {
            name: "mandragora_messages", strict: true,
            schema: { type: "object", properties: { messages: { type: "array", items: { type: "string" } } }, required: ["messages"], additionalProperties: false },
          } },
        }),
      });
      if (!response.ok) throw new Error(`AI request failed (HTTP ${response.status})`);
      const body = await response.json();
      let candidates;
      try { candidates = JSON.parse(body.choices?.[0]?.message?.content).messages; }
      catch { throw new Error("AI returned invalid JSON"); }
      if (!Array.isArray(candidates) || candidates.length > 200) throw new Error("AI returned an invalid message list");
      db.exec("BEGIN IMMEDIATE");
      try {
        const insert = db.prepare("INSERT INTO messages (id, text, source) VALUES (?, ?, 'ai')");
        for (const value of candidates) {
          if (count() >= target) break;
          if (typeof value !== "string") continue;
          const text = normalize(value);
          if ([...text].length < 5 || [...text].length > 60 || badWord(text) || seen.has(text) || excluded.has(text)) continue;
          insert.run(randomUUID(), text);
          seen.add(text);
          added++;
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    return { status: "generated", before, added, total: count() };
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await replenish())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
