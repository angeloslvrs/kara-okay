import type { DB } from './db';
import { newId, newToken } from './ids';

export type Singer = {
  id: string;
  display_name: string;
  is_member: boolean;
};

type Row = {
  id: string;
  display_name: string;
  oidc_sub: string | null;
  cookie_token: string | null;
  created_at: number;
  last_sang_at: number | null;
};

function rowToSinger(r: Row): Singer {
  return { id: r.id, display_name: r.display_name, is_member: r.oidc_sub !== null };
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('display_name is required');
  return trimmed;
}

export function registerGuest(db: DB, displayName: string): { singer: Singer; cookie_token: string } {
  const name = validateName(displayName);
  const id = newId();
  const token = newToken();
  db.prepare(
    'INSERT INTO singers (id, display_name, cookie_token, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, name, token, Date.now());
  const row = db.prepare('SELECT * FROM singers WHERE id=?').get(id) as Row;
  return { singer: rowToSinger(row), cookie_token: token };
}

export function findByCookie(db: DB, token: string): Singer | null {
  const row = db.prepare('SELECT * FROM singers WHERE cookie_token=?').get(token) as Row | undefined;
  return row ? rowToSinger(row) : null;
}

export function findById(db: DB, id: string): Singer | null {
  const row = db.prepare('SELECT * FROM singers WHERE id=?').get(id) as Row | undefined;
  return row ? rowToSinger(row) : null;
}

export function upsertMember(db: DB, oidcSub: string, displayName: string): Singer {
  const name = validateName(displayName);
  const existing = db.prepare('SELECT * FROM singers WHERE oidc_sub=?').get(oidcSub) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE singers SET display_name=? WHERE id=?').run(name, existing.id);
    return { id: existing.id, display_name: name, is_member: true };
  }
  const id = newId();
  db.prepare(
    'INSERT INTO singers (id, display_name, oidc_sub, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, name, oidcSub, Date.now());
  return { id, display_name: name, is_member: true };
}

export function updateLastSang(db: DB, singerId: string, timestamp: number): void {
  db.prepare('UPDATE singers SET last_sang_at=? WHERE id=?').run(timestamp, singerId);
}
