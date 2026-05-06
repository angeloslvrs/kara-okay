import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest } from '@/lib/singers';
import { enqueue, getActiveQueue, getCurrent, markStatus, removeEntry } from '@/lib/queue';

describe('queue (fifo)', () => {
  it('enqueues an entry with status=queued', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, {
      youtube_id: 'yt1', title: 'Song A', channel: null, duration_sec: 180, thumbnail_url: null,
    });
    expect(e.status).toBe('queued');
    expect(e.title).toBe('Song A');
  });

  it('orders queue by enqueue position (FIFO)', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    enqueue(db, a.id, { youtube_id: 'yt1', title: 'A1', channel: null, duration_sec: null, thumbnail_url: null });
    enqueue(db, b.id, { youtube_id: 'yt2', title: 'B1', channel: null, duration_sec: null, thumbnail_url: null });
    enqueue(db, a.id, { youtube_id: 'yt3', title: 'A2', channel: null, duration_sec: null, thumbnail_url: null });
    const q = getActiveQueue(db, 'fifo');
    expect(q.map((e) => e.title)).toEqual(['A1', 'B1', 'A2']);
  });

  it('excludes played/skipped/failed from active queue', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e1 = enqueue(db, singer.id, { youtube_id: 'yt1', title: 'P', channel: null, duration_sec: null, thumbnail_url: null });
    enqueue(db, singer.id, { youtube_id: 'yt2', title: 'Q', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e1.id, 'played');
    const q = getActiveQueue(db, 'fifo');
    expect(q.map((e) => e.title)).toEqual(['Q']);
  });

  it('getCurrent returns the playing entry', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    expect(getCurrent(db)?.id).toBe(e.id);
  });

  it('removes a queued entry', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    expect(removeEntry(db, e.id)).toBe(true);
    expect(getActiveQueue(db, 'fifo')).toHaveLength(0);
  });
});
