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

export type Pull = { sequence: number; client: string; channel: number; text: string; seed: number; x: number; y: number };

export function listPulls(channel: number, since: number | null) {
  const connection = db();
  const latest = Number(connection.prepare("SELECT COALESCE(MAX(sequence), 0) AS cursor FROM pulls").get()?.cursor);
  const events = since === null ? [] : connection.prepare("SELECT sequence, client, channel, text, seed, x, y FROM pulls WHERE channel = ? AND sequence > ? AND created_at > ? ORDER BY sequence LIMIT 100").all(channel, since, Date.now() - 10_000) as Pull[];
  return { events, cursor: events.length === 100 ? events[events.length - 1].sequence : latest };
}

export function savePull(pull: Omit<Pull, "sequence">, ip: string) {
  const connection = db(), now = Date.now();
  const key = createHash("sha256").update(ip).digest("hex");
  connection.exec("BEGIN IMMEDIATE");
  try {
    const last = connection.prepare("SELECT submitted_at FROM pull_cooldowns WHERE ip = ?").get(key);
    if (last && now - Number(last.submitted_at) < 300) {
      connection.exec("ROLLBACK");
      return false;
    }
    connection.prepare("INSERT INTO pulls (client, channel, text, seed, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(pull.client, pull.channel, pull.text, pull.seed, pull.x, pull.y, now);
    connection.prepare("INSERT INTO pull_cooldowns (ip, submitted_at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET submitted_at = excluded.submitted_at").run(key, now);
    connection.prepare("DELETE FROM pulls WHERE created_at < ?").run(now - 60_000);
    connection.prepare("DELETE FROM pull_cooldowns WHERE submitted_at < ?").run(now - 60_000);
    connection.exec("COMMIT");
    return true;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function hasMessage(text: string) {
  return !!db().prepare("SELECT 1 FROM messages WHERE text = ? AND source != 'ai-legacy' LIMIT 1").get(text);
}

export function listMessages(): Message[] {
  return db().prepare("SELECT id, text FROM messages WHERE source != 'ai-legacy' ORDER BY sequence DESC LIMIT 1000").all() as Message[];
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
