import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { POST as claimPOST } from '@/app/api/stage/claim/route';
import { POST as releasePOST } from '@/app/api/stage/release/route';
import { POST as hbPOST } from '@/app/api/stage/heartbeat/route';
import { POST as actionPOST } from '@/app/api/stage/action/route';
import { STAGE_TAB_COOKIE } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus, findEntry } from '@/lib/queue';
import { getDb } from '@/lib/db';

beforeEach(() => { freshDb(); });

describe('POST /api/stage/claim', () => {
  it('claims a fresh stage', async () => {
    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(`${STAGE_TAB_COOKIE}=tab-1`);
  });

  it('409 on second claim without force', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-2' }),
    }));
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.current.tab_id).toBe('tab-1');
  });

  it('force-claim bumps existing', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-2', force: true }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/stage/heartbeat', () => {
  it('updates heartbeat for active tab', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await hbPOST(makeRequest('/api/stage/heartbeat', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    expect(res.status).toBe(200);
  });

  it('404 for unknown tab', async () => {
    const res = await hbPOST(makeRequest('/api/stage/heartbeat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'nope' }),
    }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/stage/action', () => {
  it('403 without active stage cookie', async () => {
    const res = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pause' }),
    }));
    expect(res.status).toBe(403);
  });

  it('skip advances current playing entry', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    }));
    expect(res.status).toBe(200);
  });

  it('play flips ready -> playing for given entry_id', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'ready');
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'play', entry_id: e.id }),
    }));
    expect(res.status).toBe(200);
    expect(findEntry(db, e.id)?.status).toBe('playing');
  });

  it('finish flips playing -> played and bumps last_sang_at', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const before = Date.now();
    const res = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'finish' }),
    }));
    expect(res.status).toBe(200);
    expect(findEntry(db, e.id)?.status).toBe('played');
    const row = getDb().prepare('SELECT last_sang_at FROM singers WHERE id=?').get(singer.id) as { last_sang_at: number | null };
    expect(row.last_sang_at).toBeGreaterThanOrEqual(before);
  });
});

describe('POST /api/stage/release', () => {
  it('releases an active stage', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await releasePOST(makeRequest('/api/stage/release', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    expect(res.status).toBe(200);
  });
});
