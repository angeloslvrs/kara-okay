import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest } from '@/lib/singers';
import { resolveSinger, COOKIE_NAME, STAGE_TAB_COOKIE } from '@/lib/auth/session';

describe('resolveSinger', () => {
  it('returns null with no cookies', async () => {
    const db = freshDb();
    expect(await resolveSinger(db, new Map())).toBeNull();
  });

  it('finds singer by guest cookie', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const cookies = new Map([[COOKIE_NAME, cookie_token]]);
    const out = await resolveSinger(db, cookies);
    expect(out?.id).toBe(singer.id);
  });

  it('returns null for unknown cookie', async () => {
    const db = freshDb();
    const cookies = new Map([[COOKIE_NAME, 'unknown']]);
    expect(await resolveSinger(db, cookies)).toBeNull();
  });
});

describe('cookie constants', () => {
  it('defines cookie names', () => {
    expect(COOKIE_NAME).toBeTruthy();
    expect(STAGE_TAB_COOKIE).toBeTruthy();
  });
});
