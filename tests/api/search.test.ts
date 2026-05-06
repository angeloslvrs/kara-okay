import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { GET } from '@/app/api/search/route';

let fake: FakeYtDlp;

beforeEach(() => {
  freshDb();
  fake = new FakeYtDlp();
  setYtDlp(fake);
});

describe('GET /api/search', () => {
  it('400 on missing query', async () => {
    const res = await GET(makeRequest('/api/search'));
    expect(res.status).toBe(400);
  });

  it('returns normalized search results', async () => {
    fake.searchResults = [
      { youtube_id: 'a', title: 'A', channel: 'Sing King', duration_sec: 200, thumbnail_url: 'http://t/a.jpg' },
    ];
    const spy = vi.spyOn(fake, 'search');
    const res = await GET(makeRequest('/api/search?q=Wonderwall'));
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith('Wonderwall karaoke', 10);
  });

  it('does not double-append karaoke', async () => {
    const spy = vi.spyOn(fake, 'search');
    await GET(makeRequest('/api/search?q=Wonderwall karaoke'));
    expect(spy).toHaveBeenCalledWith('Wonderwall karaoke', 10);
  });

  it('502 on bot challenge', async () => {
    fake.search = async () => { const { BotChallengeError } = await import('@/lib/ytdlp/types'); throw new BotChallengeError(); };
    const res = await GET(makeRequest('/api/search?q=hi'));
    expect(res.status).toBe(502);
    const body = await readJson(res);
    expect(body.code).toBe('bot_challenge');
  });
});
