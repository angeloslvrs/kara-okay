import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { heartbeat } from '@/lib/stage';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const tabId = body?.tab_id;
  if (typeof tabId !== 'string' || !tabId) return jsonError('bad_request', 'tab_id required', 400);
  if (!heartbeat(getDb(), tabId)) return jsonError('not_found', 'unknown tab', 404);
  return jsonOk({ ok: true });
}
