import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { YtSearchResult } from './types';
import { isBotChallenge } from './detect';
import { BotChallengeError } from './types';

const exec = promisify(execFile);

function bin(): string { return process.env.YTDLP_BIN ?? 'yt-dlp'; }

function commonArgs(): string[] {
  const args: string[] = [];
  if (process.env.YTDLP_COOKIES_FILE) args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
  return args;
}

export async function ytSearch(query: string, limit = 10): Promise<YtSearchResult[]> {
  const args = [
    ...commonArgs(),
    '--dump-json', '--flat-playlist', '--no-warnings',
    `ytsearch${limit}:${query}`,
  ];
  let stdout: string, stderr: string;
  try {
    ({ stdout, stderr } = await exec(bin(), args, { maxBuffer: 32 * 1024 * 1024 }));
  } catch (err: any) {
    const msg = String(err.stderr ?? err.message ?? '');
    if (isBotChallenge(msg)) throw new BotChallengeError();
    throw err;
  }
  if (isBotChallenge(stderr ?? '')) throw new BotChallengeError();
  const out: YtSearchResult[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let j: any;
    try { j = JSON.parse(line); } catch { continue; }
    out.push({
      youtube_id: j.id,
      title: j.title ?? '(untitled)',
      channel: j.channel ?? j.uploader ?? null,
      duration_sec: typeof j.duration === 'number' ? Math.round(j.duration) : null,
      thumbnail_url: j.thumbnails?.[0]?.url ?? j.thumbnail ?? null,
    });
  }
  return out;
}
