import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { legacyPresets } from "./legacy-presets.mjs";

export function openMessageStore(path = process.env.MANDRAGORA_MESSAGES_DB || resolve(".data/messages.sqlite3")) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 100),
        source TEXT NOT NULL DEFAULT 'user'
      );
      CREATE TABLE IF NOT EXISTS cooldowns (ip TEXT PRIMARY KEY, submitted_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS ai_generation (id INTEGER PRIMARY KEY CHECK(id = 1), last_started INTEGER NOT NULL);
    `);
    if (!db.prepare("PRAGMA table_info(messages)").all().some(column => column.name === "source")) {
      db.exec("ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
    }
    if (!db.prepare("SELECT key FROM metadata WHERE key = 'presets-removed-v1'").get()) {
      // Original installation inserted these exact 70 rows first. Match both
      // position and text so later visitor submissions, even identical ones, survive.
      if (db.prepare("SELECT key FROM metadata WHERE key = 'seeded'").get()) {
        const remove = db.prepare("DELETE FROM messages WHERE sequence = ? AND text = ?");
        legacyPresets.forEach((text, index) => remove.run(index + 1, text));
      }
      db.prepare("INSERT INTO metadata (key) VALUES ('presets-removed-v1')").run();
    }
    db.exec("COMMIT");
    db.exec("PRAGMA journal_mode=WAL");
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}
