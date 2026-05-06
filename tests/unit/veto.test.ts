import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VetoStore, VETO_WINDOW_MS } from '@/lib/veto';

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
});
