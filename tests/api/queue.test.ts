import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { GET, POST } from '@/app/api/queue/route';
import { DELETE } from '@/app/api/queue/[id]/route';
import { COOKIE_NAME } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue } from '@/lib/queue';

beforeEach(() => { freshDb(); });

describe('GET /api/queue', () => {
  it('returns empty queue', async () => {
    const res = await GET(makeRequest('/api/queue'));
    const body = await readJson(res);
    expect(body.entries).toEqual([]);
    expect(body.current).toBeNull();
    expect(body.mode).toBe('fifo');
  });

  it('returns queue snapshot', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    enqueue(db, singer.id, { youtube_id: 'y', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await GET(makeRequest('/api/queue'));
    const body = await readJson(res);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].title).toBe('X');
  });
});

describe('POST /api/queue', () => {
  it('401 without singer', async () => {
    const res = await POST(makeRequest('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ youtube_id: 'y', title: 'T' }),
    }));
    expect(res.status).toBe(401);
  });

  it('enqueues with singer cookie', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const res = await POST(makeRequest('/api/queue', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ youtube_id: 'yt1', title: 'Wonderwall', duration_sec: 240, thumbnail_url: null, channel: 'Sing King' }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.entry.title).toBe('Wonderwall');
    expect(body.entry.singer.display_name).toBe('A');
  });

  it('400 on missing fields', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const res = await POST(makeRequest('/api/queue', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'no id' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/queue/:id', () => {
  it('deletes own entry', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await DELETE(makeRequest(`/api/queue/${e.id}`, {
      method: 'DELETE',
      cookies: { [COOKIE_NAME]: cookie_token },
    }), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(200);
  });

  it('403 deleting someone else\'s entry', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const other = registerGuest(db, 'B').singer;
    const e = enqueue(db, other.id, { youtube_id: 'y', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await DELETE(makeRequest(`/api/queue/${e.id}`, {
      method: 'DELETE',
      cookies: { [COOKIE_NAME]: cookie_token },
    }), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(403);
  });
});
