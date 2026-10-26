import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openMessageStore } from "./message-store.mjs";

export type Message = { id: string; text: string };
let database: DatabaseSync | undefined;

function db() {
  if (database) return database;
  database = openMessageStore();
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
