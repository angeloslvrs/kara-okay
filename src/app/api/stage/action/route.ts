import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { getStageTab } from '@/lib/auth/session';
import { getActiveStage, setPaused } from '@/lib/stage';
import { getCurrent, markStatus, getActiveQueue, findEntry } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { updateLastSang } from '@/lib/singers';
import { getBus } from '@/lib/sse';

const ACTIONS = ['skip', 'restart', 'pause', 'resume', 'seek', 'play', 'finish'] as const;
type Action = typeof ACTIONS[number];

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  const cookies = cookiesFromRequest(req);
  const tabId = getStageTab(cookies);
  const active = getActiveStage(db);
  if (!tabId || !active || active.tab_id !== tabId) return jsonError('forbidden', 'not the active stage', 403);

  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const action = body?.action as Action;
  if (!ACTIONS.includes(action)) return jsonError('bad_request', 'invalid action', 400);

  const current = getCurrent(db);
  const bus = getBus();
  const settings = getSettings(db);

  if (action === 'skip') {
    if (current) markStatus(db, current.id, 'skipped');
  } else if (action === 'restart') {
    // Stage tab applies the actual seek client-side; server logs and broadcasts.
  } else if (action === 'pause') {
    setPaused(db, true);
  } else if (action === 'resume') {
    setPaused(db, false);
  } else if (action === 'seek') {
    // Stage tab is authoritative on the seek position.
  } else if (action === 'play') {
    if (current) {
      return jsonError('conflict', 'already playing', 409);
    }
    const entryId = body?.entry_id;
    if (typeof entryId !== 'string') return jsonError('bad_request', 'entry_id required', 400);
    const entry = findEntry(db, entryId);
    if (!entry) return jsonError('not_found', 'entry not found', 404);
    markStatus(db, entry.id, 'playing');
  } else if (action === 'finish') {
    if (current) {
      markStatus(db, current.id, 'played');
      updateLastSang(db, current.singer.id, Date.now());
    }
  }

  const updatedActive = getActiveStage(db);
  const paused = updatedActive?.is_paused ?? false;
  bus.broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db), paused });
  bus.broadcast('stage.action', { action, value: body.value ?? null, paused });
  return jsonOk({ ok: true });
}
