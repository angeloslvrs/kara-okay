import type { DB } from '../db';
import type { Singer } from '../singers';
import { findByCookie } from '../singers';
import { tryGetMemberFromOidc } from './oidc';

export const COOKIE_NAME = 'karaoke_singer';
export const STAGE_TAB_COOKIE = 'karaoke_stage_tab';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type CookieMap = Map<string, string> | Record<string, string | undefined>;

function read(cookies: CookieMap, name: string): string | undefined {
  if (cookies instanceof Map) return cookies.get(name);
  return cookies[name];
}

export async function resolveSinger(db: DB, cookies: CookieMap): Promise<Singer | null> {
  const member = await tryGetMemberFromOidc(db, cookies);
  if (member) return member;
  const token = read(cookies, COOKIE_NAME);
  if (!token) return null;
  return findByCookie(db, token);
}

export function getStageTab(cookies: CookieMap): string | null {
  return read(cookies, STAGE_TAB_COOKIE) ?? null;
}
