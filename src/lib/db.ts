import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export type DB = Database.Database;

const SCHEMA = `
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

const DEFAULT_SETTINGS: Record<string, string> = {
  queue_mode: 'fifo',
  stage_immersive: '0',
  cache_max_bytes: String(5 * 1024 * 1024 * 1024),
};

export function migrate(db: DB): void {
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);
}

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const file = process.env.KARAOKE_DB ?? path.resolve('./data/karaoke.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  _db = new Database(file);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

export function openMemoryDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function setDbForTest(db: DB): void {
  _db = db;
}
