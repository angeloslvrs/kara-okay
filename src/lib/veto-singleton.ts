import { VetoStore, type VetoEvent, type PendingVeto } from './veto';
import { getBus } from './sse';
import { getDb } from './db';
import { findEntry, markStatus, getActiveQueue, getCurrent } from './queue';
import { getSettings } from './settings';
import { updateLastSang, findById as findSinger } from './singers';

declare global {
  // eslint-disable-next-line no-var
  var __karaokeVetoStore: VetoStore | undefined;
}

function applyApproval(entryId: string, action: 'restart' | 'skip') {
  const db = getDb();
  const entry = findEntry(db, entryId);
  if (!entry) return;
  if (action === 'skip') {
    markStatus(db, entry.id, 'skipped');
    if (entry.singer.id) updateLastSang(db, entry.singer.id, Date.now());
  }
  const settings = getSettings(db);
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
}

function hydrateVeto(veto: PendingVeto) {
  const singer = findSinger(getDb(), veto.singer_id);
  return { ...veto, singer };
}

function emit(e: VetoEvent) {
  const bus = getBus();
  if (e.kind === 'pending') {
    bus.broadcast('veto.pending', { veto: hydrateVeto(e.veto) });
  } else if (e.kind === 'approved') {
    const singer = findSinger(getDb(), getApprovalSingerId(e.entry_id));
    bus.broadcast('veto.approved', { veto_id: e.veto_id, action: e.action, entry_id: e.entry_id, singer });
    applyApproval(e.entry_id, e.action);
  } else {
    bus.broadcast('veto.denied', { veto_id: e.veto_id });
  }
}

function getApprovalSingerId(entryId: string): string {
  const entry = findEntry(getDb(), entryId);
  return entry?.singer.id ?? '';
}

export function getVetoStore(): VetoStore {
  if (!globalThis.__karaokeVetoStore) {
    const store = new VetoStore(emit, getDb());
    store.rehydrate();
    globalThis.__karaokeVetoStore = store;
  }
  return globalThis.__karaokeVetoStore;
}

export function resetVetoStoreForTest(): void {
  globalThis.__karaokeVetoStore = undefined;
}
