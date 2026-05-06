import type { DB } from './db';
import { newId } from './ids';
import { findById as findSinger } from './singers';
import type { Singer } from './singers';
import type { QueueMode } from './settings';

export type EntryStatus = 'queued' | 'downloading' | 'ready' | 'playing' | 'played' | 'skipped' | 'failed';

export type QueueEntry = {
  id: string;
  singer: Singer;
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
  status: EntryStatus;
  fail_reason: string | null;
  enqueued_at: number;
  started_at: number | null;
  ended_at: number | null;
};

type Row = {
  id: string;
  singer_id: string;
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
  status: EntryStatus;
  cache_path: string | null;
  fail_reason: string | null;
  enqueued_at: number;
  started_at: number | null;
  ended_at: number | null;
  position: number;
};

const ACTIVE_STATUSES = ['queued', 'downloading', 'ready'] as const;

function rowToEntry(db: DB, r: Row): QueueEntry {
  const singer = findSinger(db, r.singer_id);
  if (!singer) throw new Error(`singer ${r.singer_id} missing for entry ${r.id}`);
  return {
    id: r.id,
    singer,
    youtube_id: r.youtube_id,
    title: r.title,
    channel: r.channel,
    duration_sec: r.duration_sec,
    thumbnail_url: r.thumbnail_url,
    status: r.status,
    fail_reason: r.fail_reason,
    enqueued_at: r.enqueued_at,
    started_at: r.started_at,
    ended_at: r.ended_at,
  };
}

export type EnqueueInput = {
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
};

export function enqueue(db: DB, singerId: string, input: EnqueueInput): QueueEntry {
  const id = newId();
  const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM queue_entries').get() as any).m;
  db.prepare(
    `INSERT INTO queue_entries
     (id, singer_id, youtube_id, title, channel, duration_sec, thumbnail_url, status, enqueued_at, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(id, singerId, input.youtube_id, input.title, input.channel, input.duration_sec, input.thumbnail_url, Date.now(), maxPos + 1);
  const row = db.prepare('SELECT * FROM queue_entries WHERE id=?').get(id) as Row;
  return rowToEntry(db, row);
}

export function markStatus(db: DB, entryId: string, status: EntryStatus, extra: Partial<Row> = {}): QueueEntry | null {
  const sets: string[] = ['status=?'];
  const vals: any[] = [status];
  if (extra.cache_path !== undefined) { sets.push('cache_path=?'); vals.push(extra.cache_path); }
  if (extra.fail_reason !== undefined) { sets.push('fail_reason=?'); vals.push(extra.fail_reason); }
  if (status === 'playing') { sets.push('started_at=?'); vals.push(Date.now()); }
  if (status === 'played' || status === 'skipped' || status === 'failed') { sets.push('ended_at=?'); vals.push(Date.now()); }
  vals.push(entryId);
  db.prepare(`UPDATE queue_entries SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  const row = db.prepare('SELECT * FROM queue_entries WHERE id=?').get(entryId) as Row | undefined;
  return row ? rowToEntry(db, row) : null;
}

export function findEntry(db: DB, entryId: string): QueueEntry | null {
  const row = db.prepare('SELECT * FROM queue_entries WHERE id=?').get(entryId) as Row | undefined;
  return row ? rowToEntry(db, row) : null;
}

export function entryCachePath(db: DB, entryId: string): string | null {
  const r = db.prepare('SELECT cache_path FROM queue_entries WHERE id=?').get(entryId) as { cache_path: string | null } | undefined;
  return r?.cache_path ?? null;
}

export function getCurrent(db: DB): QueueEntry | null {
  const row = db.prepare(`SELECT * FROM queue_entries WHERE status='playing' ORDER BY started_at DESC LIMIT 1`).get() as Row | undefined;
  return row ? rowToEntry(db, row) : null;
}

export function removeEntry(db: DB, entryId: string): boolean {
  const r = db.prepare(`DELETE FROM queue_entries WHERE id=? AND status IN ('queued','downloading','ready')`).run(entryId);
  return r.changes > 0;
}

export function getActiveQueue(db: DB, mode: QueueMode): QueueEntry[] {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM queue_entries WHERE status IN (${placeholders}) ORDER BY position ASC`).all(...ACTIVE_STATUSES) as Row[];
  if (mode === 'fifo') return rows.map((r) => rowToEntry(db, r));
  return projectRoundRobin(db, rows);
}

function projectRoundRobin(db: DB, rows: Row[]): QueueEntry[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.singer_id) ?? [];
    list.push(r);
    groups.set(r.singer_id, list);
  }
  const singerOrder = Array.from(groups.keys()).sort((a, b) => {
    const ra = db.prepare('SELECT last_sang_at FROM singers WHERE id=?').get(a) as { last_sang_at: number | null };
    const rb = db.prepare('SELECT last_sang_at FROM singers WHERE id=?').get(b) as { last_sang_at: number | null };
    const av = ra.last_sang_at ?? -1;
    const bv = rb.last_sang_at ?? -1;
    return av - bv;
  });
  const out: QueueEntry[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const sid of singerOrder) {
      const list = groups.get(sid)!;
      const next = list.shift();
      if (next) {
        out.push(rowToEntry(db, next));
        progress = true;
      }
    }
  }
  return out;
}

export function listPendingDownloads(db: DB): QueueEntry[] {
  const rows = db.prepare(`SELECT * FROM queue_entries WHERE status='queued' ORDER BY position ASC`).all() as Row[];
  return rows.map((r) => rowToEntry(db, r));
}
