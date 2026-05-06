import fs from 'node:fs';
import { getDb } from '@/lib/db';
import { findEntry } from '@/lib/queue';
import { jsonError } from '@/lib/api/respond';
import { getYtDlp } from '@/lib/ytdlp';
import { BotChallengeError } from '@/lib/ytdlp/types';

type Ctx = { params: Promise<{ id: string }> };

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m) return null;
  const start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  const end = m[2] === '' ? size - 1 : Number(m[2]);
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const fallback = url.searchParams.get('fallback') === '1';

  const db = getDb();
  const entry = findEntry(db, id);
  if (!entry) return jsonError('not_found', 'entry not found', 404);

  // Try cache first.
  const path = (db.prepare('SELECT cache_path FROM queue_entries WHERE id=?').get(id) as { cache_path: string | null } | undefined)?.cache_path;
  if (path && fs.existsSync(path)) {
    const stat = fs.statSync(path);
    const range = parseRange(req.headers.get('range'), stat.size);
    if (range) {
      const stream = fs.createReadStream(path, { start: range.start, end: range.end });
      return new Response(stream as any, {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(range.end - range.start + 1),
          'content-range': `bytes ${range.start}-${range.end}/${stat.size}`,
          'accept-ranges': 'bytes',
        },
      });
    }
    const stream = fs.createReadStream(path);
    return new Response(stream as any, {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
      },
    });
  }

  if (!fallback) return jsonError('not_ready', 'no cache file; pass ?fallback=1 to use stream', 425);

  try {
    const signed = await getYtDlp().resolve(entry.youtube_id);
    return Response.redirect(signed, 302);
  } catch (err) {
    if (err instanceof BotChallengeError) return jsonError('bot_challenge', 'YouTube blocked', 502);
    return jsonError('upstream_error', String((err as Error).message), 500);
  }
}
