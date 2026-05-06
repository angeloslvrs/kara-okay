import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { getSettings, updateSettings } from '@/lib/settings';

describe('settings', () => {
  it('returns defaults', () => {
    const db = freshDb();
    const s = getSettings(db);
    expect(s.queue_mode).toBe('fifo');
    expect(s.stage_immersive).toBe(false);
    expect(s.cache_max_bytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it('updates queue_mode', () => {
    const db = freshDb();
    updateSettings(db, { queue_mode: 'round_robin' });
    expect(getSettings(db).queue_mode).toBe('round_robin');
  });

  it('updates stage_immersive', () => {
    const db = freshDb();
    updateSettings(db, { stage_immersive: true });
    expect(getSettings(db).stage_immersive).toBe(true);
  });

  it('rejects invalid queue_mode', () => {
    const db = freshDb();
    expect(() => updateSettings(db, { queue_mode: 'bogus' as any })).toThrow();
  });
});
