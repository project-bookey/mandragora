import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { legacyPresets } from "../lib/legacy-presets.mjs";
import { openMessageStore } from "../lib/message-store.mjs";
import { naturalMessage, repeatsMessage, replenish } from "./generate-messages.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "mandragora-generation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "messages.sqlite3");
}
const varied = [
  "이 노래 전주부터 좋다", "수건을 너무 조금 샀나", "안경 닦으니까 살 것 같네", "택배 기사님 오시기 전에 씻어야겠어", "주머니에 영수증이 왜 이렇게 많지",
  "모기 소리 나만 들려?", "이거 조립 설명서 어디 갔지", "엄마한테 전화해야겠다", "우산 빌려준 거 받아야 하는데", "옆집 강아지 이름이 궁금하다",
  "신발 끈 풀린 줄도 몰랐네", "책갈피 대신 쓰던 게 상품권이었어", "이 셔츠 이제 좀 작은데", "머리 자를 때 된 것 같지?", "버스 창가 자리 비었다",
  "잠깐만 나 아직 준비 안 됐어", "저기 구름 꼭 물고기처럼 생겼어", "비밀번호 바꾼 내가 밉다", "나 이거 어릴 때 진짜 좋아했어", "엘리베이터 거울은 왜 더 잘 보이지", "귤 껍질이 한 번에 벗겨졌다",
];
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
  db.prepare("DELETE FROM metadata WHERE key = 'ai-fresh-v3'").run();
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
  for (const value of ["1. 오늘은 좀 쉬고 싶다", '"오늘은 좀 쉬고 싶다"', "# 오늘은 좀 쉬고 싶다", "오늘은 쉬고\n내일 일하자", "just five more minutes", "가".repeat(41), "AI로서 답변을 드립니다", "창문开着 놓고 잤나봐", "오늘은 좀 쉬고 싶다 😊", 42]) {
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
    return response(varied);
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
    return response([varied[3],varied[3],legacyPresets[0],"시발 정말", "가".repeat(61),42]);
  }});
  assert.equal(calls,3);
  assert.equal(result.added,1);
});

test("persist cooldown after upstream failure and block concurrent generations",async t=>{
  const path=await fixture(t);
  await assert.rejects(replenish({path,key:"test-only",now:1000,fetcher:async()=>new Response("private upstream details",{status:429})}),/HTTP 429/);
  assert.equal((await replenish({path,key:"test-only",now:2000,fetcher:()=>{throw new Error("must not retry");}})).status,"skipped");
  fill(path,29);
  let calls=0;
  const options={path,key:"test-only",now:3_601_001,fetcher:async()=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,10));
    return response(varied);
  }};
  const results=await Promise.all([replenish(options),replenish(options)]);
  assert.equal(calls,1);
  assert.equal(results.filter(result=>result.status==="generated").length,1);
});

test("reject recycled AI text, small rewrites and copies inside one response", async t => {
  assert.equal(repeatsMessage("커피를 마시고도 졸려!", ["커피를 마시고도 졸려"]), true);
  assert.equal(repeatsMessage("아침에 눈 뜨자마자 핸드폰을 봤다", ["아침에 눈 뜨자마자 폰을 봤다"]), true);
  assert.equal(repeatsMessage("우산을 놓고 왔네", ["저녁에 비 온대"]), false);
  const path = await fixture(t);
  const db = openMessageStore(path);
  db.prepare("INSERT INTO messages (id,text,source) VALUES ('retired','아침에 눈 뜨자마자 폰을 봤다','ai-legacy')").run();
  db.close();
  const result = await replenish({path,key:"test-only",fetcher:async()=>response([
    "아침에 눈 뜨자마자 폰을 봤다!", "아침에 눈 뜨자마자 핸드폰을 봤다", varied[3], varied[3] + "!",
  ])});
  assert.equal(result.added, 1);
});
