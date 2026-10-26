import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import seeds from "./seeds.json";

export type Message = { id: string; text: string };
let database: DatabaseSync | undefined;

function db() {
  if (database) return database;
  const path = process.env.MANDRAGORA_MESSAGES_DB || resolve(".data/messages.sqlite3");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(path, { timeout: 5000 });
  connection.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 100)
    );
    CREATE TABLE IF NOT EXISTS cooldowns (ip TEXT PRIMARY KEY, submitted_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY);
  `);
  connection.exec("BEGIN IMMEDIATE");
  try {
    if (!connection.prepare("SELECT key FROM metadata WHERE key = 'seeded'").get()) {
      const insert = connection.prepare("INSERT INTO messages (id, text) VALUES (?, ?)");
      for (const text of seeds) insert.run(randomUUID(), text);
      connection.prepare("INSERT INTO metadata (key) VALUES ('seeded')").run();
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    connection.close();
    throw error;
  }
  database = connection;
  return database;
}

export function listMessages(): Message[] {
  return db().prepare("SELECT id, text FROM messages ORDER BY sequence DESC LIMIT 1000").all() as Message[];
}

export function saveMessage(text: string, ip: string): { row: Message } | { wait: number } {
  const connection = db();
  const key = createHash("sha256").update(ip).digest("hex");
  const now = Date.now();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const last = connection.prepare("SELECT submitted_at FROM cooldowns WHERE ip = ?").get(key);
    if (last && now - Number(last.submitted_at) < 30_000) {
      connection.exec("ROLLBACK");
      return { wait: Math.ceil((30_000 - (now - Number(last.submitted_at))) / 1000) };
    }
    const row = { id: randomUUID(), text };
    connection.prepare("INSERT INTO messages (id, text) VALUES (?, ?)").run(row.id, row.text);
    connection.prepare("INSERT INTO cooldowns (ip, submitted_at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET submitted_at = excluded.submitted_at").run(key, now);
    connection.prepare("DELETE FROM cooldowns WHERE submitted_at < ?").run(now - 60_000);
    connection.exec("COMMIT");
    return { row };
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
