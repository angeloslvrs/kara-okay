import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { resolveSinger, getStageTab } from '@/lib/auth/session';
import { getActiveStage } from '@/lib/stage';
import { findEntry, removeEntry, getActiveQueue, getCurrent } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { getBus } from '@/lib/sse';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const db = getDb();
  const cookies = cookiesFromRequest(req);
  const entry = findEntry(db, id);
  if (!entry) return jsonError('not_found', 'entry not found', 404);

  const singer = await resolveSinger(db, cookies);
  const stageTab = getStageTab(cookies);
  const activeStage = getActiveStage(db);
  const isStage = stageTab !== null && activeStage?.tab_id === stageTab;
  const isOwner = singer !== null && entry.singer.id === singer.id;

  if (!isStage && !isOwner) return jsonError('forbidden', 'cannot delete this entry', 403);

  if (!removeEntry(db, id)) return jsonError('conflict', 'entry no longer removable', 409);
  const settings = getSettings(db);
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
  return jsonOk({ ok: true });
}
