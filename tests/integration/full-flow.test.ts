import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setDbForTest, openMemoryDb, type DB } from '@/lib/db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { POST as singerPOST } from '@/app/api/singer/route';
import { GET as searchGET } from '@/app/api/search/route';
import { POST as queuePOST } from '@/app/api/queue/route';
import { POST as stageClaimPOST } from '@/app/api/stage/claim/route';
import { POST as singerActionPOST } from '@/app/api/singer/action/route';
import { POST as vetoPOST } from '@/app/api/veto/[id]/route';
import { COOKIE_NAME, STAGE_TAB_COOKIE } from '@/lib/auth/session';
import { findEntry, markStatus } from '@/lib/queue';
import { resetVetoStoreForTest } from '@/lib/veto-singleton';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const enabled = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!enabled)('full flow integration', () => {
  let dir: string;
  let fake: FakeYtDlp;
  let db: DB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-int-'));
    process.env.CACHE_DIR = dir;
    db = openMemoryDb();
    setDbForTest(db);
    resetVetoStoreForTest();
    fake = new FakeYtDlp();
    fake.searchResults = [{ youtube_id: 'yt1', title: 'Wonderwall (karaoke)', channel: 'Sing King', duration_sec: 240, thumbnail_url: null }];
    setYtDlp(fake);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('full singer-driven veto flow', async () => {
    // Register
    const reg = await singerPOST(makeRequest('/api/singer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Angelo' }),
    }));
    const cookieToken = /karaoke_singer=([^;]+)/.exec(reg.headers.get('set-cookie')!)![1];

    // Search and enqueue
    const sres = await searchGET(makeRequest('/api/search?q=Wonderwall'));
    const sbody = await readJson(sres);
    const eres = await queuePOST(makeRequest('/api/queue', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookieToken },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sbody.results[0]),
    }));
    const entryId = (await readJson(eres)).entry.id;

    // Wait for download worker microtask
    await new Promise((r) => setImmediate(r));
    expect(fake.downloadCalls.length).toBeGreaterThan(0);
    expect(findEntry(db, entryId)?.status).toBe('ready');

    // Stage claim and start playing
    await stageClaimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    markStatus(db, entryId, 'playing');

    // Singer requests restart
    const ares = await singerActionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookieToken },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restart', entry_id: entryId }),
    }));
    const { veto_id } = await readJson(ares);

    // Stage allows
    const dres = await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(dres.status).toBe(200);

    // Restart leaves entry as 'playing' (client-side seek, no server transition)
    expect(findEntry(db, entryId)?.status).toBe('playing');
  });
});
