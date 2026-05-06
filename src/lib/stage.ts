import type { DB } from './db';

export const STAGE_HEARTBEAT_TTL_MS = 30_000;

export type StageSession = {
  tab_id: string;
  claimed_at: number;
  last_heartbeat: number;
};

export type ClaimResult =
  | { kind: 'claimed'; session: StageSession; evicted: string | null }
  | { kind: 'conflict'; current: StageSession };

export function getActiveStage(db: DB): StageSession | null {
  const row = db.prepare('SELECT * FROM stage_session LIMIT 1').get() as StageSession | undefined;
  if (!row) return null;
  if (Date.now() - row.last_heartbeat > STAGE_HEARTBEAT_TTL_MS) return null;
  return row;
}

export function claimStage(db: DB, tabId: string, force: boolean): ClaimResult {
  const current = getActiveStage(db);
  if (current && current.tab_id !== tabId && !force) {
    return { kind: 'conflict', current };
  }
  const evicted = current && current.tab_id !== tabId ? current.tab_id : null;
  db.prepare('DELETE FROM stage_session').run();
  const now = Date.now();
  db.prepare('INSERT INTO stage_session (tab_id, claimed_at, last_heartbeat) VALUES (?, ?, ?)').run(tabId, now, now);
  return { kind: 'claimed', session: { tab_id: tabId, claimed_at: now, last_heartbeat: now }, evicted };
}

export function heartbeat(db: DB, tabId: string): boolean {
  const r = db.prepare('UPDATE stage_session SET last_heartbeat=? WHERE tab_id=?').run(Date.now(), tabId);
  return r.changes > 0;
}

export function releaseStage(db: DB, tabId: string): boolean {
  const r = db.prepare('DELETE FROM stage_session WHERE tab_id=?').run(tabId);
  return r.changes > 0;
}
