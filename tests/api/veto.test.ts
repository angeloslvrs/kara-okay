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
import { getBus } from '@/lib/sse';

beforeEach(() => { vi.useFakeTimers(); freshDb(); resetVetoStoreForTest(); });
afterEach(() => vi.useRealTimers());

async function setupPlaying() {
  const db = freshDb();
  resetVetoStoreForTest();
  const { cookie_token, singer } = registerGuest(db, 'A');
  const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
  await stageClaimPOST(makeRequest('/api/stage/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
  }));
  markStatus(db, e.id, 'playing');
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

  it('veto.pending SSE event carries hydrated singer', async () => {
    const { cookie_token, entry_id } = await setupPlaying();
    const events: Array<{ event: string; data: any }> = [];
    const unsub = getBus().subscribe((event, data) => { events.push({ event, data }); });
    try {
      await actionPOST(makeRequest('/api/singer/action', {
        method: 'POST',
        cookies: { [COOKIE_NAME]: cookie_token },
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'skip', entry_id }),
      }));
    } finally { unsub(); }
    const pending = events.find((e) => e.event === 'veto.pending');
    expect(pending).toBeDefined();
    expect(pending!.data.veto.singer).toBeDefined();
    expect(pending!.data.veto.singer.display_name).toBe('A');
    expect(pending!.data.veto.singer.id).toBeDefined();
  });

  it('veto.approved SSE event carries hydrated singer', async () => {
    const { cookie_token, entry_id } = await setupPlaying();
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    }));
    const { veto_id } = await readJson(res);
    const events: Array<{ event: string; data: any }> = [];
    const unsub = getBus().subscribe((event, data) => { events.push({ event, data }); });
    try {
      await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
        method: 'POST',
        cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'allow' }),
      }), { params: Promise.resolve({ id: veto_id }) });
    } finally { unsub(); }
    const approved = events.find((e) => e.event === 'veto.approved');
    expect(approved).toBeDefined();
    expect(approved!.data.singer).toBeDefined();
    expect(approved!.data.singer.display_name).toBe('A');
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
