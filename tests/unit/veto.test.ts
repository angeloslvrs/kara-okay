import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VetoStore, VETO_WINDOW_MS } from '@/lib/veto';
import { openMemoryDb } from '@/lib/db';

describe('VetoStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens a veto and emits pending', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    expect(v.action).toBe('restart');
    expect(events).toEqual([{ kind: 'pending', veto: v }]);
  });

  it('approves on explicit allow', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    const result = store.decide(v.id, 'allow');
    expect(result).toBe('approved');
    expect(events.at(-1)).toEqual({ kind: 'approved', veto_id: v.id, action: 'restart', entry_id: 'e1' });
  });

  it('denies on explicit deny', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'skip', entry_id: 'e1', singer_id: 's1' });
    const result = store.decide(v.id, 'deny');
    expect(result).toBe('denied');
    expect(events.at(-1)).toEqual({ kind: 'denied', veto_id: v.id });
  });

  it('auto-approves after window', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    expect(events.at(-1)).toEqual({ kind: 'approved', veto_id: v.id, action: 'restart', entry_id: 'e1' });
  });

  it('returns "unknown" on decide for missing id', () => {
    const store = new VetoStore(() => {});
    expect(store.decide('nope', 'allow')).toBe('unknown');
  });

  it('does not double-resolve', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    store.decide(v.id, 'allow');
    expect(store.decide(v.id, 'deny')).toBe('unknown');
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    const approveCount = events.filter((e) => e.kind === 'approved').length;
    expect(approveCount).toBe(1);
  });

  // -- new persistence behavior --

  it('persists pending veto to the database', () => {
    const db = openMemoryDb();
    const store = new VetoStore((_e: any) => {}, db);
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    const row = db.prepare('SELECT * FROM pending_vetos WHERE id=?').get(v.id) as any;
    expect(row).toBeDefined();
    expect(row.action).toBe('restart');
    expect(row.entry_id).toBe('e1');
  });

  it('removes row on decide', () => {
    const db = openMemoryDb();
    const store = new VetoStore((_e: any) => {}, db);
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    store.decide(v.id, 'allow');
    const row = db.prepare('SELECT * FROM pending_vetos WHERE id=?').get(v.id);
    expect(row).toBeUndefined();
  });

  it('rehydrate schedules timers for unexpired rows', () => {
    const db = openMemoryDb();
    const events: any[] = [];
    const storeA = new VetoStore((e: any) => events.push(e), db);
    storeA.open({ action: 'skip', entry_id: 'e2', singer_id: 's2' });
    // Simulate restart: drop in-memory state by constructing a new store against the same db.
    const events2: any[] = [];
    const storeB = new VetoStore((e: any) => events2.push(e), db);
    storeB.rehydrate();
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    expect(events2.some((e) => e.kind === 'approved')).toBe(true);
  });

  it('rehydrate immediately approves rows already expired', () => {
    const db = openMemoryDb();
    db.prepare(
      'INSERT INTO pending_vetos (id, action, entry_id, singer_id, expires_at, created_at) VALUES (?,?,?,?,?,?)'
    ).run('v-expired', 'skip', 'e3', 's3', Date.now() - 1000, Date.now() - 2000);
    const events: any[] = [];
    const store = new VetoStore((e: any) => events.push(e), db);
    store.rehydrate();
    expect(events).toEqual([{ kind: 'approved', veto_id: 'v-expired', action: 'skip', entry_id: 'e3' }]);
    const row = db.prepare('SELECT * FROM pending_vetos WHERE id=?').get('v-expired');
    expect(row).toBeUndefined();
  });

  it('dedupes: same entry + same action returns the existing veto', () => {
    const db = openMemoryDb();
    const events: any[] = [];
    const store = new VetoStore((e: any) => events.push(e), db);
    const a = store.open({ action: 'skip', entry_id: 'e4', singer_id: 's4' });
    const b = store.open({ action: 'skip', entry_id: 'e4', singer_id: 's4' });
    expect(b.id).toBe(a.id);
    expect(events.filter((e) => e.kind === 'pending').length).toBe(1);
  });

  it('replaces on different action: clears old timer, emits new pending', () => {
    const db = openMemoryDb();
    const events: any[] = [];
    const store = new VetoStore((e: any) => events.push(e), db);
    const a = store.open({ action: 'restart', entry_id: 'e5', singer_id: 's5' });
    const b = store.open({ action: 'skip', entry_id: 'e5', singer_id: 's5' });
    expect(b.id).not.toBe(a.id);
    expect(events.filter((e) => e.kind === 'pending').length).toBe(2);
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    const approvals = events.filter((e) => e.kind === 'approved');
    expect(approvals.length).toBe(1);
    expect(approvals[0].action).toBe('skip');
    expect(approvals[0].veto_id).toBe(b.id);
  });
});
