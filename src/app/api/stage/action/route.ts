import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { getStageTab } from '@/lib/auth/session';
import { getActiveStage } from '@/lib/stage';
import { getCurrent, markStatus, getActiveQueue } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { getBus } from '@/lib/sse';

const ACTIONS = ['skip', 'restart', 'pause', 'resume', 'seek'] as const;
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
  } else if (action === 'pause' || action === 'resume') {
    // Same — stage tab is authoritative on player state.
  } else if (action === 'seek') {
    // Same.
  }

  bus.broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
  bus.broadcast('stage.action', { action, value: body.value ?? null });
  return jsonOk({ ok: true });
}
