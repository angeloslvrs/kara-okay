import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';

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
});
