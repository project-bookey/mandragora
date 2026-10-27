import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { legacyPresets } from "../lib/legacy-presets.mjs";
import { openMessageStore } from "../lib/message-store.mjs";
import { naturalMessage, replenish } from "./generate-messages.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "mandragora-generation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "messages.sqlite3");
}
const response = messages => Response.json({ choices: [{ message: { content: JSON.stringify({ messages }) } }] });
function fill(path, n) {
  const db = openMessageStore(path);
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO messages (id,text) VALUES (?,?)").run(`user-${i}`, `방문자가 남긴 문장 ${i}`);
  db.close();
}

test("migration removes only original presets and never inserts presets", async t => {
  const path = await fixture(t);
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, text TEXT); CREATE TABLE metadata (key TEXT PRIMARY KEY); INSERT INTO metadata VALUES ('seeded')");
  const insert = old.prepare("INSERT INTO messages (id,text) VALUES (?,?)");
  legacyPresets.forEach((text,i) => insert.run(`seed-${i}`,text));
  insert.run("visitor",legacyPresets[0]);
  old.close();
  const db = openMessageStore(path);
  assert.deepEqual(db.prepare("SELECT id,text,source FROM messages").all().map(row => ({...row})), [{id:"visitor",text:legacyPresets[0],source:"user"}]);
  db.close();
  const reopened = openMessageStore(path);
  assert.equal(reopened.prepare("SELECT count(*) AS n FROM messages").get().n,1);
  reopened.close();
});

test("30 messages suppress all AI calls", async t => {
  const path = await fixture(t);
  fill(path,30);
  const result = await replenish({path,fetcher:()=>{throw new Error("must not call AI");}});
  assert.equal(result.status,"skipped");
});

test("retire old AI messages without deleting visitor text or newly generated AI", async t => {
  const path = await fixture(t);
  const db = openMessageStore(path);
  db.prepare("INSERT INTO messages (id,text,source) VALUES ('old-ai','뿌리가 퇴근을 선언했다','ai')").run();
  db.prepare("INSERT INTO messages (id,text,source) VALUES ('visitor','뿌리가 퇴근을 선언했다','user')").run();
  db.prepare("DELETE FROM metadata WHERE key = 'ai-natural-v2'").run();
  db.close();
  const migrated = openMessageStore(path);
  assert.equal(migrated.prepare("SELECT source FROM messages WHERE id='old-ai'").get().source, "ai-legacy");
  assert.equal(migrated.prepare("SELECT source FROM messages WHERE id='visitor'").get().source, "user");
  migrated.prepare("INSERT INTO messages (id,text,source) VALUES ('new-ai','아까 뭐 하려고 했더라','ai')").run();
  migrated.close();
  const reopened = openMessageStore(path);
  assert.equal(reopened.prepare("SELECT source FROM messages WHERE id='new-ai'").get().source, "ai");
  assert.equal(reopened.prepare("SELECT count(*) AS n FROM messages").get().n, 3);
  reopened.close();
});

test("AI output validation rejects formatted, multiline, non-Korean and long responses", () => {
  assert.equal(naturalMessage("  분명 한 입만 먹으려고 했는데  "), "분명 한 입만 먹으려고 했는데");
  for (const value of ["1. 오늘은 좀 쉬고 싶다", '"오늘은 좀 쉬고 싶다"', "# 오늘은 좀 쉬고 싶다", "오늘은 쉬고\n내일 일하자", "just five more minutes", "가".repeat(41), "AI로서 답변을 드립니다", 42]) {
    assert.equal(naturalMessage(value), null, String(value));
  }
});

test("29 messages replenish to 50 and preserve all visitor messages", async t => {
  const path = await fixture(t);
  fill(path,29);
  let calls=0;
  const result=await replenish({path,key:"test-only",fetcher:async (_url,options)=>{
    calls++;
    assert.ok(!options.body.includes("방문자가 남긴 문장"),"visitor text must not be sent to AI");
    return response(Array.from({length:60},(_,i)=>`뿌리가 먼저 퇴근 선언했어 ${i}`));
  }});
  assert.equal(result.total,50);
  assert.equal(result.added,21);
  assert.equal(calls,1);
  const db=openMessageStore(path);
  assert.equal(db.prepare("SELECT count(*) AS n FROM messages WHERE source='user'").get().n,29);
  assert.equal(db.prepare("SELECT count(*) AS n FROM messages WHERE source='ai'").get().n,21);
  db.close();
});

test("reject duplicate, preset, profane and oversized output; cap retries",async t=>{
  const path=await fixture(t);
  let calls=0;
  const result=await replenish({path,key:"test-only",fetcher:async()=>{
    calls++;
    return response(["뿌리에도 유급 휴가를 달라","뿌리에도 유급 휴가를 달라",legacyPresets[0],"시발 정말", "가".repeat(61),42]);
  }});
  assert.equal(calls,3);
  assert.equal(result.added,1);
});

test("persist cooldown after upstream failure and block concurrent generations",async t=>{
  const path=await fixture(t);
  await assert.rejects(replenish({path,key:"test-only",now:1000,fetcher:async()=>new Response("private upstream details",{status:429})}),/HTTP 429/);
  assert.equal((await replenish({path,key:"test-only",now:2000,fetcher:()=>{throw new Error("must not retry");}})).status,"skipped");
  let calls=0;
  const options={path,key:"test-only",now:3_601_001,fetcher:async()=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,10));
    return response(Array.from({length:50},(_,i)=>`뿌리의 비밀 작전 시작이다 ${i}`));
  }};
  const results=await Promise.all([replenish(options),replenish(options)]);
  assert.equal(calls,1);
  assert.equal(results.filter(result=>result.status==="generated").length,1);
});
