import { VetoStore, type VetoEvent } from './veto';
import { getBus } from './sse';

let _store: VetoStore | null = null;

function emit(e: VetoEvent) {
  const bus = getBus();
  if (e.kind === 'pending') {
    bus.broadcast('veto.pending', { veto: e.veto });
  } else if (e.kind === 'approved') {
    bus.broadcast('veto.approved', { veto_id: e.veto_id, action: e.action, entry_id: e.entry_id });
  } else {
    bus.broadcast('veto.denied', { veto_id: e.veto_id });
  }
}

export function getVetoStore(): VetoStore {
  if (!_store) _store = new VetoStore(emit);
  return _store;
}

export function resetVetoStoreForTest(): void {
  _store = null;
}
