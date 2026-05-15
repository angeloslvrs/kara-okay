import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { claimStage, releaseStage, heartbeat, getActiveStage, STAGE_HEARTBEAT_TTL_MS } from '@/lib/stage';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus, findEntry } from '@/lib/queue';

describe('stage', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('claims when no active stage', () => {
    const db = freshDb();
    const r = claimStage(db, 'tab-1', false);
    expect(r.kind).toBe('claimed');
    expect(getActiveStage(db)?.tab_id).toBe('tab-1');
  });

  it('rejects second claim without force', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    const r = claimStage(db, 'tab-2', false);
    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') expect(r.current.tab_id).toBe('tab-1');
  });

  it('force-claim evicts existing', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    const r = claimStage(db, 'tab-2', true);
    expect(r.kind).toBe('claimed');
    if (r.kind === 'claimed') expect(r.evicted).toBe('tab-1');
    expect(getActiveStage(db)?.tab_id).toBe('tab-2');
  });

  it('claim succeeds if existing heartbeat is stale', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    vi.advanceTimersByTime(STAGE_HEARTBEAT_TTL_MS + 100);
    const r = claimStage(db, 'tab-2', false);
    expect(r.kind).toBe('claimed');
  });

  it('heartbeat updates last_heartbeat', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    vi.advanceTimersByTime(5000);
    heartbeat(db, 'tab-1');
    const s = getActiveStage(db);
    expect(s?.last_heartbeat).toBe(1_005_000);
  });

  it('heartbeat from unknown tab returns false', () => {
    const db = freshDb();
    expect(heartbeat(db, 'nope')).toBe(false);
  });

  it('release clears active stage', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    expect(releaseStage(db, 'tab-1')).toBe(true);
    expect(getActiveStage(db)).toBeNull();
  });
});

describe('getActiveStage stale-heartbeat sweep', () => {
  beforeEach(() => { freshDb(); });

  it('clears stale stage row and sweeps orphan playing entries', () => {
    const db = freshDb();
    claimStage(db, 'tab-a', false);
    db.prepare('UPDATE stage_session SET last_heartbeat=?').run(Date.now() - STAGE_HEARTBEAT_TTL_MS - 1);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');

    const active = getActiveStage(db);
    expect(active).toBeNull();

    expect(findEntry(db, e.id)!.status).toBe('skipped');
    const row = db.prepare('SELECT COUNT(*) AS c FROM stage_session').get() as { c: number };
    expect(row.c).toBe(0);
  });
});
