import { getDb } from '@/lib/db';
import { registerGuest } from '@/lib/singers';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { setCookieHeader } from '@/lib/api/cookies';
import { COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth/session';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const name = body?.display_name;
  if (typeof name !== 'string' || !name.trim()) return jsonError('bad_request', 'display_name required', 400);
  try {
    const { singer, cookie_token } = registerGuest(getDb(), name);
    return jsonOk({ singer }, {
      headers: { 'set-cookie': setCookieHeader(COOKIE_NAME, cookie_token, { maxAge: COOKIE_MAX_AGE }) },
    });
  } catch (err) {
    return jsonError('bad_request', (err as Error).message, 400);
  }
}
