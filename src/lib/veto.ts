import { newId } from './ids';
import type { DB } from './db';

export const VETO_WINDOW_MS = 5_000;

export type VetoAction = 'restart' | 'skip';

export type PendingVeto = {
  id: string;
  action: VetoAction;
  entry_id: string;
  singer_id: string;
  expires_at: number;
};

export type VetoEvent =
  | { kind: 'pending'; veto: PendingVeto }
  | { kind: 'approved'; veto_id: string; action: VetoAction; entry_id: string }
  | { kind: 'denied'; veto_id: string };

export type Decision = 'allow' | 'deny';
export type DecideResult = 'approved' | 'denied' | 'unknown';

type Row = {
  id: string;
  action: VetoAction;
  entry_id: string;
  singer_id: string;
  expires_at: number;
  created_at: number;
};

export class VetoStore {
  private timers = new Map<string, NodeJS.Timeout>();
  private memory = new Map<string, PendingVeto>();

  constructor(private emit: (e: VetoEvent) => void, private db?: DB) {}

  open(input: { action: VetoAction; entry_id: string; singer_id: string }): PendingVeto {
    const existing = this.findByEntry(input.entry_id);
    if (existing) {
      if (existing.action === input.action) return existing;
      // Replace: same entry, different action.
      this.clearLocally(existing.id);
    }

    const id = newId();
    const veto: PendingVeto = {
      id,
      action: input.action,
      entry_id: input.entry_id,
      singer_id: input.singer_id,
      expires_at: Date.now() + VETO_WINDOW_MS,
    };
    this.persist(veto);
    this.schedule(veto);
    this.emit({ kind: 'pending', veto });
    return veto;
  }

  decide(id: string, decision: Decision): DecideResult {
    const v = this.lookup(id);
    if (!v) return 'unknown';
    this.clearLocally(id);
    if (decision === 'allow') {
      this.emit({ kind: 'approved', veto_id: id, action: v.action, entry_id: v.entry_id });
      return 'approved';
    }
    this.emit({ kind: 'denied', veto_id: id });
    return 'denied';
  }

  list(): PendingVeto[] {
    if (this.db) {
      const rows = this.db.prepare('SELECT * FROM pending_vetos').all() as Row[];
      return rows.map(rowToVeto);
    }
    return Array.from(this.memory.values());
  }

  rehydrate(): void {
    if (!this.db) return;
    const rows = this.db.prepare('SELECT * FROM pending_vetos').all() as Row[];
    const now = Date.now();
    for (const row of rows) {
      if (row.expires_at <= now) {
        this.db.prepare('DELETE FROM pending_vetos WHERE id=?').run(row.id);
        this.emit({ kind: 'approved', veto_id: row.id, action: row.action, entry_id: row.entry_id });
        continue;
      }
      this.schedule(rowToVeto(row));
    }
  }

  // -- internals --

  private lookup(id: string): PendingVeto | null {
    if (this.db) {
      const row = this.db.prepare('SELECT * FROM pending_vetos WHERE id=?').get(id) as Row | undefined;
      return row ? rowToVeto(row) : null;
    }
    return this.memory.get(id) ?? null;
  }

  private findByEntry(entryId: string): PendingVeto | null {
    if (this.db) {
      const row = this.db.prepare('SELECT * FROM pending_vetos WHERE entry_id=? LIMIT 1').get(entryId) as Row | undefined;
      return row ? rowToVeto(row) : null;
    }
    for (const v of this.memory.values()) if (v.entry_id === entryId) return v;
    return null;
  }

  private persist(v: PendingVeto): void {
    if (this.db) {
      this.db.prepare(
        'INSERT INTO pending_vetos (id, action, entry_id, singer_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(v.id, v.action, v.entry_id, v.singer_id, v.expires_at, Date.now());
    } else {
      this.memory.set(v.id, v);
    }
  }

  private schedule(v: PendingVeto): void {
    const delay = Math.max(0, v.expires_at - Date.now());
    const t = setTimeout(() => this.resolveApprove(v), delay);
    this.timers.set(v.id, t);
  }

  private clearLocally(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    if (this.db) {
      this.db.prepare('DELETE FROM pending_vetos WHERE id=?').run(id);
    } else {
      this.memory.delete(id);
    }
  }

  private resolveApprove(v: PendingVeto): void {
    // Only fire if our timer is still the active one for this veto.
    if (!this.timers.has(v.id)) return;
    this.clearLocally(v.id);
    this.emit({ kind: 'approved', veto_id: v.id, action: v.action, entry_id: v.entry_id });
  }
}

function rowToVeto(r: Row): PendingVeto {
  return {
    id: r.id,
    action: r.action,
    entry_id: r.entry_id,
    singer_id: r.singer_id,
    expires_at: r.expires_at,
  };
}
