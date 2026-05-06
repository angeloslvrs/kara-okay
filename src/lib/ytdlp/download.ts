import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { isBotChallenge } from './detect';
import { BotChallengeError } from './types';

function bin(): string { return process.env.YTDLP_BIN ?? 'yt-dlp'; }

export async function ytDownload(youtubeId: string, destPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.part`;
  const args: string[] = [];
  if (process.env.YTDLP_COOKIES_FILE) args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
  args.push(
    '-f', 'mp4',
    '--no-warnings',
    '-o', tmp,
    `https://www.youtube.com/watch?v=${youtubeId}`,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin(), args);
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      if (isBotChallenge(stderr)) return reject(new BotChallengeError());
      reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-500)}`));
    });
  });
  fs.renameSync(tmp, destPath);
}
