import { newId } from './ids';

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

type Entry = { veto: PendingVeto; timer: NodeJS.Timeout };

export class VetoStore {
  private map = new Map<string, Entry>();
  constructor(private emit: (e: VetoEvent) => void) {}

  open(input: { action: VetoAction; entry_id: string; singer_id: string }): PendingVeto {
    const id = newId();
    const veto: PendingVeto = {
      id,
      action: input.action,
      entry_id: input.entry_id,
      singer_id: input.singer_id,
      expires_at: Date.now() + VETO_WINDOW_MS,
    };
    const timer = setTimeout(() => this.resolveApprove(id), VETO_WINDOW_MS);
    this.map.set(id, { veto, timer });
    this.emit({ kind: 'pending', veto });
    return veto;
  }

  decide(id: string, decision: Decision): DecideResult {
    const e = this.map.get(id);
    if (!e) return 'unknown';
    clearTimeout(e.timer);
    this.map.delete(id);
    if (decision === 'allow') {
      this.emit({ kind: 'approved', veto_id: id, action: e.veto.action, entry_id: e.veto.entry_id });
      return 'approved';
    }
    this.emit({ kind: 'denied', veto_id: id });
    return 'denied';
  }

  list(): PendingVeto[] {
    return Array.from(this.map.values()).map((e) => e.veto);
  }

  private resolveApprove(id: string) {
    const e = this.map.get(id);
    if (!e) return;
    this.map.delete(id);
    this.emit({ kind: 'approved', veto_id: id, action: e.veto.action, entry_id: e.veto.entry_id });
  }
}
