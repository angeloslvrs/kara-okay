import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { setCookieHeader } from '@/lib/api/cookies';
import { STAGE_TAB_COOKIE, COOKIE_MAX_AGE } from '@/lib/auth/session';
import { claimStage } from '@/lib/stage';
import { getBus } from '@/lib/sse';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const tabId = body?.tab_id;
  if (typeof tabId !== 'string' || !tabId) return jsonError('bad_request', 'tab_id required', 400);

  const r = claimStage(getDb(), tabId, body?.force === true);
  if (r.kind === 'conflict') {
    return new Response(
      JSON.stringify({ error: 'stage already claimed', code: 'conflict', current: r.current }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    );
  }

  const bus = getBus();
  bus.broadcast('stage.claimed', { session: r.session });
  if (r.evicted) bus.broadcast('stage.evicted', { tab_id: r.evicted });
  return jsonOk({ ok: true }, {
    headers: { 'set-cookie': setCookieHeader(STAGE_TAB_COOKIE, tabId, { maxAge: COOKIE_MAX_AGE }) },
  });
}
