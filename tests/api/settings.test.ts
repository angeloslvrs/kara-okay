import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { GET, PUT } from '@/app/api/settings/route';

beforeEach(() => { freshDb(); });

describe('settings api', () => {
  it('GET returns defaults', async () => {
    const res = await GET();
    const body = await readJson(res);
    expect(body.queue_mode).toBe('fifo');
    expect(body.stage_immersive).toBe(false);
  });

  it('PUT updates queue_mode', async () => {
    const res = await PUT(makeRequest('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queue_mode: 'round_robin' }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.settings.queue_mode).toBe('round_robin');
  });

  it('PUT 400 on invalid value', async () => {
    const res = await PUT(makeRequest('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queue_mode: 'bogus' }),
    }));
    expect(res.status).toBe(400);
  });
});
