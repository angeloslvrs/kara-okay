import { getDb } from '@/lib/db';
import { resolveSinger } from '@/lib/auth/session';
import { jsonOk } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';

export async function GET(req: Request): Promise<Response> {
  const singer = await resolveSinger(getDb(), cookiesFromRequest(req));
  return jsonOk({ singer });
}
