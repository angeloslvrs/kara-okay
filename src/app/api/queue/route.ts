import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { resolveSinger } from '@/lib/auth/session';
import { enqueue, getActiveQueue, getCurrent } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { getActiveStage } from '@/lib/stage';
import { getBus } from '@/lib/sse';
import { kickWorker } from '@/lib/worker/download-worker';

export async function GET(_req: Request): Promise<Response> {
  const db = getDb();
  const settings = getSettings(db);
  const entries = getActiveQueue(db, settings.queue_mode);
  const current = getCurrent(db);
  const active = getActiveStage(db);
  const paused = active?.is_paused ?? false;
  return jsonOk({ entries, current, mode: settings.queue_mode, paused });
}

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  const singer = await resolveSinger(db, cookiesFromRequest(req));
  if (!singer) return jsonError('unauthorized', 'register first', 401);
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const youtube_id = body?.youtube_id;
  const title = body?.title;
  if (typeof youtube_id !== 'string' || !youtube_id.trim()) return jsonError('bad_request', 'youtube_id required', 400);
  if (typeof title !== 'string' || !title.trim()) return jsonError('bad_request', 'title required', 400);
  const entry = enqueue(db, singer.id, {
    youtube_id,
    title,
    channel: typeof body.channel === 'string' ? body.channel : null,
    duration_sec: typeof body.duration_sec === 'number' ? body.duration_sec : null,
    thumbnail_url: typeof body.thumbnail_url === 'string' ? body.thumbnail_url : null,
  });
  kickWorker();
  const settings = getSettings(db);
  const active = getActiveStage(db);
  const paused = active?.is_paused ?? false;
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db), paused });
  return jsonOk({ entry });
}
