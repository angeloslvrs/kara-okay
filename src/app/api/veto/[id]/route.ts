import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { getStageTab } from '@/lib/auth/session';
import { getActiveStage } from '@/lib/stage';
import { getVetoStore } from '@/lib/veto-singleton';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const db = getDb();
  const cookies = cookiesFromRequest(req);
  const tabId = getStageTab(cookies);
  const active = getActiveStage(db);
  if (!tabId || !active || active.tab_id !== tabId) return jsonError('forbidden', 'not the active stage', 403);

  const { id } = await ctx.params;
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const decision = body?.decision;
  if (decision !== 'allow' && decision !== 'deny') return jsonError('bad_request', 'invalid decision', 400);

  const result = getVetoStore().decide(id, decision);
  if (result === 'unknown') return jsonError('not_found', 'veto expired or unknown', 404);
  return jsonOk({ ok: true });
}
