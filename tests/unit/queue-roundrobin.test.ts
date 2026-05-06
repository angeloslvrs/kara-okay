import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest, updateLastSang } from '@/lib/singers';
import { enqueue, getActiveQueue } from '@/lib/queue';

function add(db: any, sid: string, title: string) {
  return enqueue(db, sid, { youtube_id: title, title, channel: null, duration_sec: null, thumbnail_url: null });
}

describe('queue (round-robin)', () => {
  it('interleaves singers by last_sang_at (nulls first)', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    updateLastSang(db, a.id, 5000);
    add(db, a.id, 'A1');
    add(db, a.id, 'A2');
    add(db, b.id, 'B1');
    const q = getActiveQueue(db, 'round_robin');
    expect(q.map((e) => e.title)).toEqual(['B1', 'A1', 'A2']);
  });

  it('orders never-sung singers by registration order via last_sang_at=null', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    add(db, b.id, 'B1');
    add(db, a.id, 'A1');
    add(db, b.id, 'B2');
    add(db, a.id, 'A2');
    const q = getActiveQueue(db, 'round_robin');
    expect(q.map((e) => e.title)).toEqual(['B1', 'A1', 'B2', 'A2']);
  });

  it('falls through if a singer has nothing queued in this round', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    add(db, a.id, 'A1');
    add(db, a.id, 'A2');
    add(db, a.id, 'A3');
    add(db, b.id, 'B1');
    const q = getActiveQueue(db, 'round_robin');
    expect(q.map((e) => e.title)).toEqual(['A1', 'B1', 'A2', 'A3']);
  });

  it('returns empty for no entries', () => {
    const db = freshDb();
    expect(getActiveQueue(db, 'round_robin')).toEqual([]);
  });
});
