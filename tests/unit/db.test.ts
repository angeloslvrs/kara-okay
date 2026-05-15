import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { migrate, openMemoryDb } from '@/lib/db';

describe('db migration', () => {
  it('creates all tables and seeds settings', () => {
    const db = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map((t: any) => t.name);
    expect(names).toContain('singers');
    expect(names).toContain('queue_entries');
    expect(names).toContain('settings');
    expect(names).toContain('stage_session');

    const mode = db.prepare("SELECT value FROM settings WHERE key='queue_mode'").get() as any;
    expect(mode.value).toBe('fifo');
  });

  it('sets user_version to the migration count', () => {
    const db = freshDb();
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });

  it('is idempotent — re-running does not clobber user-edited settings', () => {
    const db = freshDb();
    db.prepare("UPDATE settings SET value='round_robin' WHERE key='queue_mode'").run();
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    migrate(db);
    const mode = db.prepare("SELECT value FROM settings WHERE key='queue_mode'").get() as any;
    expect(mode.value).toBe('round_robin');
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });
});

describe('schema migrations', () => {
  it('creates pending_vetos table', () => {
    const db = openMemoryDb();
    const cols = db.prepare("PRAGMA table_info(pending_vetos)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['action', 'created_at', 'entry_id', 'expires_at', 'id', 'singer_id']);
  });

  it('adds is_paused column to stage_session', () => {
    const db = openMemoryDb();
    const cols = db.prepare("PRAGMA table_info(stage_session)").all() as Array<{ name: string; dflt_value: string | null }>;
    const isPaused = cols.find((c) => c.name === 'is_paused');
    expect(isPaused).toBeDefined();
    expect(isPaused?.dflt_value).toBe('0');
  });

  it('bumps user_version to 2', () => {
    const db = openMemoryDb();
    const v = db.pragma('user_version', { simple: true }) as number;
    expect(v).toBe(2);
  });
});
