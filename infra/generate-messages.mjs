import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { openMessageStore } from "../lib/message-store.mjs";
import { legacyPresets } from "../lib/legacy-presets.mjs";
import { badWord } from "../lib/badwords.js";

const normalize = value => value.normalize("NFC").replace(/\s+/g, " ").trim();

const voice = `한국어 익명 놀이터에서 사람이 툭 남길 법한 짧은 혼잣말을 쓴다. 만드라고라를 뽑으면 이 말이 말풍선에 뜬다.
자연스러운 한국어 구어체가 최우선이다. 소리 내 읽었을 때 친구가 실제로 할 법한 말만 남긴다.
한 문장은 5~40자, 한 가지 생각만 담는다. 대체로 10~25자 정도로 짧게 쓴다.
배고픔, 늦잠, 귀찮음, 딴생각, 사소한 발견, 별일 없는 하루 등 구체적인 일상을 골고루 쓴다. 담백한 말과 살짝 웃긴 말을 섞고 모든 말을 농담으로 만들려 하지 않는다.
자연스러운 말투 예시: '아까 뭐 하려고 했더라', '분명 한 입만 먹으려고 했는데', '지금 누우면 못 일어날 것 같아'. 예시는 복사하거나 단어만 바꿔 쓰지 않는다.
어색한 말 예시: '뿌리가 퇴근을 선언했다', '오늘도 광합성 플렉스', '흙 이불 속 행복 충전 완료'. 이런 의인화, 유행어 끼워넣기, 광고 문구 같은 표현을 피한다.
뿌리·잎·흙·광합성·만드라고라를 소재로 삼지 않는다. 번역투, 문어체, 억지 비유, 뜬금없는 단어 조합, 과한 감탄사, 이모지, 해시태그를 쓰지 않는다.
같은 문장 구조나 끝맺음, 소재를 반복하지 않는다. 조언, 명언, 뻔한 위로, 상대에게 하는 평가도 피한다.
욕설, 혐오, 성적 표현, 개인정보, 광고, 정치, 자해, 상대 비하를 넣지 않는다.
설명, 번호, 따옴표 장식, AI 언급 없이 JSON 객체의 messages 배열로만 응답한다. 출력 전에 각 문장을 읽고 어색한 문장은 평범한 일상 말로 다시 쓴다.`;

export function naturalMessage(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value.trim())) return null;
  const text = normalize(value);
  if ([...text].length < 5 || [...text].length > 40 || badWord(text)) return null;
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
          if (!text || seen.has(text) || excluded.has(text)) continue;
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
