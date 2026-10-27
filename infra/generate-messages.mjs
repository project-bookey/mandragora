import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { openMessageStore } from "../lib/message-store.mjs";
import { legacyPresets } from "../lib/legacy-presets.mjs";
import { badWord } from "../lib/badwords.js";

const normalize = value => value.normalize("NFC").replace(/\s+/g, " ").trim();

const voice = `한국인이 익명 게시판에 남기는 짧은 한마디를 새로 쓴다.
실제 대화에서 자연스럽게 쓸 법한 한국어 구어체로, 한 문장에 5~40자만 쓴다.
만들어낸 상황을 설명하거나 일기를 요약하지 말고 말 한마디 자체를 쓴다.
사소한 경험, 문득 든 생각, 짧은 반응 등 서로 다른 상황을 고른다. 모든 말을 웃기게 만들 필요는 없다.
뿌리, 잎, 흙, 광합성, 만드라고라 소재와 억지 의인화는 쓰지 않는다.
번역투, 어색한 비유, 광고 같은 표현, 명언, 상투적인 위로, 유행어 억지 삽입은 쓰지 않는다.
같은 소재와 문장 틀을 반복하거나 단어만 바꾼 문장을 여러 개 쓰지 않는다. 이전에 만든 문장을 재사용하지 말고 매번 상황부터 새로 고른다.
한국어 외의 문자가 섞이지 않게 한다. 욕설, 혐오, 성적 표현, 개인정보, 광고, 정치, 자해, 상대 비하는 금지한다.
설명, 번호, 따옴표 장식, 이모지, AI 언급 없이 JSON 객체의 messages 배열로만 응답한다.
마지막에 각 문장을 소리 내 읽는다고 생각하고, 한국어 화자가 실제로 하지 않을 법한 표현은 버린다.`;

const fingerprint = text => normalize(text).replace(/[^가-힣a-z0-9]/gi, "").toLowerCase();
const grams = text => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));

// Reject punctuation changes and small rewrites, including retired AI text.
export function repeatsMessage(text, previous) {
  const a = fingerprint(text), ag = grams(a);
  return previous.some(value => {
    const b = fingerprint(value);
    if (a === b) return true;
    const bg = grams(b);
    if (!ag.size || !bg.size) return false;
    const overlap = [...ag].filter(part => bg.has(part)).length;
    return 2 * overlap / (ag.size + bg.size) >= 0.7;
  });
}

export function naturalMessage(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value.trim())) return null;
  const text = normalize(value);
  if ([...text].length < 5 || [...text].length > 40 || badWord(text)) return null;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}]/u.test(text)) return null;
  if (!/[가-힣]/.test(text) || /^(?:[-*#•]|\d+[.)]|["'“‘「『])/.test(text) || /https?:\/\/|www\.|```|(?:인공지능|언어 모델|AI로서)/i.test(text)) return null;
  return text;
}

export async function replenish({
  path = process.env.MANDRAGORA_MESSAGES_DB,
  fetcher = fetch,
  key = process.env.GROQ_API_KEY,
  model = process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
  now = Date.now(),
} = {}) {
  const db = openMessageStore(path);
  const count = () => Number(db.prepare("SELECT count(*) AS n FROM messages WHERE source != 'ai-legacy'").get().n);
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
    const previousAI = db.prepare("SELECT text FROM messages WHERE source IN ('ai', 'ai-legacy')").all().map(row => String(row.text));
    const previous = [...previousAI, ...legacyPresets];
    let added = 0;
    // Three bounded requests at most per hour, including failed attempts.
    for (let attempt = 0; attempt < 3 && count() < target; attempt++) {
      const needed = target - count();
      const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0.8, max_completion_tokens: 4096,
          messages: [
            { role: "system", content: voice },
            { role: "user", content: `서로 다른 일상 한마디 ${Math.min(needed, 20)}개를 써 줘. 억지로 웃기려 하지 말고 자연스러운 말만 남겨 줘.` },
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
          const text = naturalMessage(value);
          if (!text || seen.has(text) || excluded.has(text) || repeatsMessage(text, previous)) continue;
          insert.run(randomUUID(), text);
          seen.add(text);
          previous.push(text);
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
