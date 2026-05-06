import { jsonOk, jsonError } from '@/lib/api/respond';
import { getYtDlp } from '@/lib/ytdlp';
import { BotChallengeError } from '@/lib/ytdlp/types';
import { normalizeQuery } from '@/lib/search-query';
import { getBus } from '@/lib/sse';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (!q || !q.trim()) return jsonError('bad_request', 'q is required', 400);
  try {
    const results = await getYtDlp().search(normalizeQuery(q), 10);
    return jsonOk({ results });
  } catch (err) {
    if (err instanceof BotChallengeError) {
      getBus().broadcast('bot_challenge', { detected_at: Date.now() });
      return jsonError('bot_challenge', 'YouTube is challenging requests; set YTDLP_COOKIES_FILE', 502);
    }
    return jsonError('upstream_error', String((err as Error).message), 500);
  }
}
