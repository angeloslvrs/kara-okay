import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus, findEntry, sweepOrphanPlaying } from '@/lib/queue';

describe('sweepOrphanPlaying', () => {
  beforeEach(() => { freshDb(); });

  it('flips a single playing entry to skipped and sets ended_at', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    const before = Date.now();

    const changed = sweepOrphanPlaying(db);

    expect(changed).toBe(1);
    const row = findEntry(db, e.id)!;
    expect(row.status).toBe('skipped');
    expect(row.ended_at).toBeGreaterThanOrEqual(before);
  });

  it('returns 0 when nothing is playing', () => {
    const db = freshDb();
    expect(sweepOrphanPlaying(db)).toBe(0);
  });

  it('does not touch queued/downloading/ready/played/failed', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const queued = enqueue(db, singer.id, { youtube_id: 'q', title: 'q', channel: null, duration_sec: null, thumbnail_url: null });
    const ready = enqueue(db, singer.id, { youtube_id: 'r', title: 'r', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, ready.id, 'ready');
    const played = enqueue(db, singer.id, { youtube_id: 'p', title: 'p', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, played.id, 'played');

    expect(sweepOrphanPlaying(db)).toBe(0);
    expect(findEntry(db, queued.id)!.status).toBe('queued');
    expect(findEntry(db, ready.id)!.status).toBe('ready');
    expect(findEntry(db, played.id)!.status).toBe('played');
  });
});
