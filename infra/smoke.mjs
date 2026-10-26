import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

const temporary = await mkdtemp(join(tmpdir(), "mandragora-smoke-"));
const socket = createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const root = `http://127.0.0.1:${port}/mandragora`;
let child;
let output = "";
async function start() {
  child = spawn(process.execPath, ["server.js"], {
    cwd: resolve(".next/standalone"),
    env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), MANDRAGORA_MESSAGES_DB: join(temporary, "messages.sqlite3") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(`${root}/api/health/`);
      if (response.ok) return;
    } catch { /* Wait for startup. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server startup timed out: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
const post = (text, ip) => fetch(`${root}/api/mandrakes/`, {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ text }),
});
try {
  await start();
  assert.equal((await fetch(`${root}/`)).status, 200, "subpath page must render without redirect loops");
  assert.equal((await fetch(`${root}/sprites/b_r1a.webp`)).status, 200, "sprite must load from subpath");
  const initial = await (await fetch(`${root}/api/mandrakes/`)).json();
  assert.equal(initial.length, 0, "new databases must not contain presets");
  const created = await post("배포 저장 검증", "192.0.2.1");
  assert.equal(created.status, 201);
  const row = await created.json();
  assert.equal((await post("중복 입력", "192.0.2.1")).status, 429);
  assert.equal((await post("", "192.0.2.2")).status, 400);
  assert.equal((await post("가".repeat(101), "192.0.2.2")).status, 400);
  const parallel = await Promise.all([post("동시 입력 하나", "192.0.2.3"), post("동시 입력 둘", "192.0.2.3")]);
  assert.deepEqual(parallel.map(r => r.status).sort(), [201, 429]);
  await stop();
  await start();
  const restored = await (await fetch(`${root}/api/mandrakes/`)).json();
  assert.equal(restored.length, 2);
  assert.ok(restored.some(item => item.id === row.id && item.text === row.text), "message survives restart");
  assert.equal((await post("재시작 우회", "192.0.2.1")).status, 429, "cooldown survives restart");
  console.log("Smoke checks passed: subpath, sprites, empty initial store, writes, validation, concurrent cooldown, restart persistence.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
