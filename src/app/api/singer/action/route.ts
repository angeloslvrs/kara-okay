import { getDb } from '@/lib/db';
import { resolveSinger } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { findEntry } from '@/lib/queue';
import { getVetoStore } from '@/lib/veto-singleton';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const action = body?.action;
  const entry_id = body?.entry_id;
  if (action !== 'restart' && action !== 'skip') return jsonError('bad_request', 'invalid action', 400);
  if (typeof entry_id !== 'string') return jsonError('bad_request', 'entry_id required', 400);

  const db = getDb();
  const singer = await resolveSinger(db, cookiesFromRequest(req));
  if (!singer) return jsonError('unauthorized', 'register first', 401);

  const entry = findEntry(db, entry_id);
  if (!entry) return jsonError('not_found', 'entry not found', 404);
  if (entry.status !== 'playing') return jsonError('conflict', 'entry is not playing', 409);
  if (entry.singer.id !== singer.id) return jsonError('forbidden', 'not your turn', 403);

  const veto = getVetoStore().open({ action, entry_id, singer_id: singer.id });
  return jsonOk({ veto_id: veto.id });
}
