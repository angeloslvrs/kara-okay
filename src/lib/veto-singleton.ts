import { VetoStore, type VetoEvent } from './veto';
import { getBus } from './sse';
import { getDb } from './db';
import { findEntry, markStatus, getActiveQueue, getCurrent } from './queue';
import { getSettings } from './settings';
import { updateLastSang } from './singers';

let _store: VetoStore | null = null;

function applyApproval(entryId: string, action: 'restart' | 'skip') {
  const db = getDb();
  const entry = findEntry(db, entryId);
  if (!entry) return;
  if (action === 'skip') {
    markStatus(db, entry.id, 'skipped');
    if (entry.singer.id) updateLastSang(db, entry.singer.id, Date.now());
  }
  // 'restart' is applied client-side by the stage tab seeking to 0; we just signal via SSE.
  const settings = getSettings(db);
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
}

function emit(e: VetoEvent) {
  const bus = getBus();
  if (e.kind === 'pending') {
    bus.broadcast('veto.pending', { veto: e.veto });
  } else if (e.kind === 'approved') {
    bus.broadcast('veto.approved', { veto_id: e.veto_id, action: e.action, entry_id: e.entry_id });
    applyApproval(e.entry_id, e.action);
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
