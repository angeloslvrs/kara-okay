import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest, findByCookie, upsertMember, findById, updateLastSang } from '@/lib/singers';

describe('singers', () => {
  it('registers a guest with a cookie token', () => {
    const db = freshDb();
    const { singer, cookie_token } = registerGuest(db, 'Angelo');
    expect(singer.display_name).toBe('Angelo');
    expect(singer.is_member).toBe(false);
    expect(cookie_token).toBeTruthy();
  });

  it('finds guest by cookie', () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'Angelo');
    const found = findByCookie(db, cookie_token);
    expect(found?.display_name).toBe('Angelo');
  });

  it('returns null for unknown cookie', () => {
    const db = freshDb();
    expect(findByCookie(db, 'nope')).toBeNull();
  });

  it('upserts a member by oidc_sub', () => {
    const db = freshDb();
    const a = upsertMember(db, 'sub-1', 'Angelo S.');
    const b = upsertMember(db, 'sub-1', 'Angelo Soliveres');
    expect(a.id).toBe(b.id);
    expect(b.display_name).toBe('Angelo Soliveres');
    expect(b.is_member).toBe(true);
  });

  it('updates last_sang_at', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'Angelo');
    updateLastSang(db, singer.id, 1234);
    const row = db.prepare('SELECT last_sang_at FROM singers WHERE id=?').get(singer.id) as any;
    expect(row.last_sang_at).toBe(1234);
  });

  it('rejects empty display name', () => {
    const db = freshDb();
    expect(() => registerGuest(db, '')).toThrow();
    expect(() => registerGuest(db, '   ')).toThrow();
  });
});
