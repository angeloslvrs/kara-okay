import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { POST as registerPOST } from '@/app/api/singer/route';
import { GET as meGET } from '@/app/api/singer/me/route';
import { POST as actionPOST } from '@/app/api/singer/action/route';
import { COOKIE_NAME } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus } from '@/lib/queue';
import { resetVetoStoreForTest } from '@/lib/veto-singleton';

beforeEach(() => { freshDb(); resetVetoStoreForTest(); });

describe('POST /api/singer', () => {
  it('registers a guest and sets cookie', async () => {
    const res = await registerPOST(makeRequest('/api/singer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Angelo' }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.singer.display_name).toBe('Angelo');
    expect(res.headers.get('set-cookie')).toContain(`${COOKIE_NAME}=`);
  });

  it('400 on empty name', async () => {
    const res = await registerPOST(makeRequest('/api/singer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: '' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/singer/me', () => {
  it('returns null without cookie', async () => {
    const res = await meGET(makeRequest('/api/singer/me'));
    const body = await readJson(res);
    expect(body.singer).toBeNull();
  });

  it('returns singer with cookie', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const res = await meGET(makeRequest('/api/singer/me', { cookies: { [COOKIE_NAME]: cookie_token } }));
    const body = await readJson(res);
    expect(body.singer.id).toBe(singer.id);
  });
});

describe('POST /api/singer/action', () => {
  it('403 if not the playing singer', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const other = registerGuest(db, 'B').singer;
    const e = enqueue(db, other.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restart', entry_id: e.id }),
    }));
    expect(res.status).toBe(403);
  });

  it('opens a veto when current singer requests', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restart', entry_id: e.id }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.veto_id).toBeTruthy();
  });
});
