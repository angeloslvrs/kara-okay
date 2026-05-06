import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { freshDb } from '../helpers/test-db';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { registerGuest } from '@/lib/singers';
import { enqueue, findEntry } from '@/lib/queue';
import { runWorkerOnce } from '@/lib/worker/download-worker';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-w-'));
  process.env.CACHE_DIR = dir;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('download worker', () => {
  it('downloads a queued entry and flips status to ready', async () => {
    const db = freshDb();
    const fake = new FakeYtDlp();
    setYtDlp(fake);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    await runWorkerOnce();
    const after = findEntry(db, e.id);
    expect(after?.status).toBe('ready');
    expect(fake.downloadCalls).toHaveLength(1);
  });

  it('marks failed on download error', async () => {
    const db = freshDb();
    const fake = new FakeYtDlp();
    fake.downloadShouldFail = true;
    setYtDlp(fake);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    await runWorkerOnce();
    const after = findEntry(db, e.id);
    expect(after?.status).toBe('failed');
  });

  it('drains entries enqueued mid-run', async () => {
    const db = freshDb();
    const fake = new FakeYtDlp();
    // Enqueue a second entry while the first is downloading.
    fake.downloadDelayMs = 0;
    let secondEntryId: string | null = null;
    const origDownload = fake.download.bind(fake);
    fake.download = async (yt, dest) => {
      // First call: enqueue a second entry mid-flight. It should still be
      // picked up before runWorkerOnce returns.
      if (yt === 'yt1' && !secondEntryId) {
        const { singer: s2 } = registerGuest(db, 'B');
        const e2 = enqueue(db, s2.id, { youtube_id: 'yt2', title: 't2', channel: null, duration_sec: null, thumbnail_url: null });
        secondEntryId = e2.id;
      }
      return origDownload(yt, dest);
    };
    setYtDlp(fake);
    const { singer } = registerGuest(db, 'A');
    const e1 = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't1', channel: null, duration_sec: null, thumbnail_url: null });
    await runWorkerOnce();
    expect(findEntry(db, e1.id)?.status).toBe('ready');
    expect(secondEntryId).not.toBeNull();
    expect(findEntry(db, secondEntryId!)?.status).toBe('ready');
  });
});
