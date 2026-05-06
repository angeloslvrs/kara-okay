import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isBotChallenge } from './detect';
import { BotChallengeError } from './types';

const exec = promisify(execFile);

function bin(): string { return process.env.YTDLP_BIN ?? 'yt-dlp'; }

export async function ytResolve(youtubeId: string): Promise<string> {
  const args: string[] = [];
  if (process.env.YTDLP_COOKIES_FILE) args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
  args.push('-g', '-f', 'mp4', `https://www.youtube.com/watch?v=${youtubeId}`);
  try {
    const { stdout } = await exec(bin(), args, { maxBuffer: 1024 * 1024 });
    return stdout.split('\n')[0].trim();
  } catch (err: any) {
    const msg = String(err.stderr ?? err.message ?? '');
    if (isBotChallenge(msg)) throw new BotChallengeError();
    throw err;
  }
}
