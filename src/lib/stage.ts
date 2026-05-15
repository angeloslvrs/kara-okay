import type { DB } from './db';
import { sweepOrphanPlaying } from './queue';

export const STAGE_HEARTBEAT_TTL_MS = 30_000;

export type StageSession = {
  tab_id: string;
  claimed_at: number;
  last_heartbeat: number;
  is_paused: boolean;
};

export type ClaimResult =
  | { kind: 'claimed'; session: StageSession; evicted: string | null }
  | { kind: 'conflict'; current: StageSession };

type Row = {
  tab_id: string;
  claimed_at: number;
  last_heartbeat: number;
  is_paused: number;
};

function rowToSession(r: Row): StageSession {
  return {
    tab_id: r.tab_id,
    claimed_at: r.claimed_at,
    last_heartbeat: r.last_heartbeat,
    is_paused: r.is_paused === 1,
  };
}

export function getActiveStage(db: DB): StageSession | null {
  const row = db.prepare('SELECT * FROM stage_session LIMIT 1').get() as Row | undefined;
  if (!row) return null;
  if (Date.now() - row.last_heartbeat > STAGE_HEARTBEAT_TTL_MS) {
    // Stale: clean up the dead session and any orphan playing entry.
    db.prepare('DELETE FROM stage_session WHERE tab_id=?').run(row.tab_id);
    sweepOrphanPlaying(db);
    return null;
  }
  return rowToSession(row);
}

export function claimStage(db: DB, tabId: string, force: boolean): ClaimResult {
  const current = getActiveStage(db);
  if (current && current.tab_id !== tabId && !force) {
    return { kind: 'conflict', current };
  }
  const evicted = current && current.tab_id !== tabId ? current.tab_id : null;
  db.prepare('DELETE FROM stage_session').run();
  const now = Date.now();
  db.prepare(
    'INSERT INTO stage_session (tab_id, claimed_at, last_heartbeat, is_paused) VALUES (?, ?, ?, 0)',
  ).run(tabId, now, now);
  return {
    kind: 'claimed',
    session: { tab_id: tabId, claimed_at: now, last_heartbeat: now, is_paused: false },
    evicted,
  };
}

export function heartbeat(db: DB, tabId: string): boolean {
  const r = db.prepare('UPDATE stage_session SET last_heartbeat=? WHERE tab_id=?').run(Date.now(), tabId);
  return r.changes > 0;
}

export function releaseStage(db: DB, tabId: string): boolean {
  const r = db.prepare('DELETE FROM stage_session WHERE tab_id=?').run(tabId);
  return r.changes > 0;
}

export function setPaused(db: DB, paused: boolean): boolean {
  const r = db.prepare('UPDATE stage_session SET is_paused=?').run(paused ? 1 : 0);
  return r.changes > 0;
}
