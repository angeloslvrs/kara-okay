import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest } from '../helpers/api-helpers';
import { POST as claimPOST } from '@/app/api/stage/claim/route';
import { enqueue, markStatus, findEntry } from '@/lib/queue';
import { registerGuest } from '@/lib/singers';

beforeEach(() => { freshDb(); });

describe('stage claim sweeps orphan playing rows', () => {
  it('flips a leftover playing entry to skipped when a new claim arrives', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');

    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-fresh' }),
    }));
    expect(res.status).toBe(200);
    expect(findEntry(db, e.id)!.status).toBe('skipped');
  });
});
