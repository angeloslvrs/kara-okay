import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { POST as actionPOST } from '@/app/api/singer/action/route';
import { POST as vetoPOST } from '@/app/api/veto/[id]/route';
import { POST as stageClaimPOST } from '@/app/api/stage/claim/route';
import { COOKIE_NAME, STAGE_TAB_COOKIE } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus, findEntry } from '@/lib/queue';
import { resetVetoStoreForTest } from '@/lib/veto-singleton';

beforeEach(() => { vi.useFakeTimers(); freshDb(); resetVetoStoreForTest(); });
afterEach(() => vi.useRealTimers());

async function setupPlaying() {
  const db = freshDb();
  resetVetoStoreForTest();
  const { cookie_token, singer } = registerGuest(db, 'A');
  const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
  markStatus(db, e.id, 'playing');
  await stageClaimPOST(makeRequest('/api/stage/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
  }));
  return { db, cookie_token, entry_id: e.id };
}

describe('veto flow', () => {
  it('singer requests skip, stage allows, entry gets skipped', async () => {
    const { db, cookie_token, entry_id } = await setupPlaying();
    const req = makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    });
    const res = await actionPOST(req);
    const { veto_id } = await readJson(res);

    const decideRes = await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(decideRes.status).toBe(200);
    const e = findEntry(db, entry_id);
    expect(e?.status).toBe('skipped');
  });

  it('singer requests skip, stage denies, entry stays playing', async () => {
    const { db, cookie_token, entry_id } = await setupPlaying();
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    }));
    const { veto_id } = await readJson(res);
    await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'deny' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(findEntry(db, entry_id)?.status).toBe('playing');
  });

  it('timeout auto-approves after 5s', async () => {
    const { db, cookie_token, entry_id } = await setupPlaying();
    await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    }));
    vi.advanceTimersByTime(5_100);
    expect(findEntry(db, entry_id)?.status).toBe('skipped');
  });

  it('403 vetoing without stage cookie', async () => {
    const { cookie_token, entry_id } = await setupPlaying();
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    }));
    const { veto_id } = await readJson(res);
    const decide = await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(decide.status).toBe(403);
  });
});
