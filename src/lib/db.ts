import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export type DB = Database.Database;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS singers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  oidc_sub TEXT UNIQUE,
  cookie_token TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_sang_at INTEGER
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  singer_id TEXT NOT NULL REFERENCES singers(id),
  youtube_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT,
  duration_sec INTEGER,
  thumbnail_url TEXT,
  status TEXT NOT NULL,
  cache_path TEXT,
  fail_reason TEXT,
  enqueued_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_session (
  tab_id TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_entries(status);
CREATE INDEX IF NOT EXISTS idx_queue_position ON queue_entries(position);
CREATE INDEX IF NOT EXISTS idx_singers_cookie ON singers(cookie_token);
CREATE INDEX IF NOT EXISTS idx_singers_oidc ON singers(oidc_sub);
`;

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS pending_vetos (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  singer_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_vetos_entry ON pending_vetos(entry_id);

ALTER TABLE stage_session ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
`;

// Append-only. Each entry is a SQL string applied once when user_version is below its index+1.
// Adding a new migration: push the next ALTER/CREATE here; never edit a past entry.
const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2];

const DEFAULT_SETTINGS: Record<string, string> = {
  queue_mode: 'fifo',
  stage_immersive: '0',
  cache_max_bytes: String(5 * 1024 * 1024 * 1024),
};

export function migrate(db: DB): void {
  const run = db.transaction(() => {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version >= MIGRATIONS.length) return;
    for (let i = version; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]);
    }
    db.pragma(`user_version = ${MIGRATIONS.length}`);
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);
  });
  run();
}

// Survive Next.js dev-mode module re-evaluation — otherwise HMR can hand
// out fresh DB handles while old SQL statements still hold prepared cursors
// against the previous handle.
declare global {
  // eslint-disable-next-line no-var
  var __karaokeDb: DB | undefined;
}

export function getDb(): DB {
  if (globalThis.__karaokeDb) return globalThis.__karaokeDb;
  const file = process.env.KARAOKE_DB ?? path.resolve('./data/karaoke.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  globalThis.__karaokeDb = db;
  return db;
}

export function openMemoryDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function setDbForTest(db: DB): void {
  globalThis.__karaokeDb = db;
}
