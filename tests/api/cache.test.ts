import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { freshDb } from '../helpers/test-db';
import { makeRequest } from '../helpers/api-helpers';
import { GET } from '@/app/api/cache/[id]/route';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus } from '@/lib/queue';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-api-'));
  process.env.CACHE_DIR = dir;
  freshDb();
  setYtDlp(new FakeYtDlp());
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('GET /api/cache/:id', () => {
  it('404 when entry missing', async () => {
    const res = await GET(makeRequest('/api/cache/nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('serves file when cache_path set', async () => {
    const db = freshDb();
    setYtDlp(new FakeYtDlp());
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    const file = path.join(dir, 'yt1.mp4');
    fs.writeFileSync(file, Buffer.from('hello world'));
    markStatus(db, e.id, 'ready', { cache_path: file } as any);
    const res = await GET(makeRequest(`/api/cache/${e.id}`), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe('hello world');
  });

  it('returns 206 with Range', async () => {
    const db = freshDb();
    setYtDlp(new FakeYtDlp());
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    const file = path.join(dir, 'yt1.mp4');
    fs.writeFileSync(file, Buffer.from('0123456789'));
    markStatus(db, e.id, 'ready', { cache_path: file } as any);
    const res = await GET(makeRequest(`/api/cache/${e.id}`, { headers: { range: 'bytes=2-5' } }), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(206);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe('2345');
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
  });

  it('falls back via 302 when no cache file and ?fallback=1', async () => {
    const db = freshDb();
    const fake = new FakeYtDlp();
    fake.resolveUrl = 'https://signed.example/video.mp4';
    setYtDlp(fake);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await GET(makeRequest(`/api/cache/${e.id}?fallback=1`), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://signed.example/video.mp4');
  });
});
