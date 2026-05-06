import path from 'node:path';
import { getDb } from '../db';
import { listPendingDownloads, markStatus, getActiveQueue, getCurrent } from '../queue';
import { getYtDlp, BotChallengeError } from '../ytdlp';
import { CacheManager } from '../cache';
import { getSettings } from '../settings';
import { getBus } from '../sse';

let running = false;

function cacheDir(): string { return process.env.CACHE_DIR ?? path.resolve('./data/cache'); }

export async function runWorkerOnce(): Promise<void> {
  const db = getDb();
  const settings = getSettings(db);
  const cache = new CacheManager(cacheDir(), settings.cache_max_bytes);
  const ytdlp = getYtDlp();
  const pending = listPendingDownloads(db);

  for (const entry of pending) {
    markStatus(db, entry.id, 'downloading');
    getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
    const dest = cache.pathFor(entry.youtube_id);
    try {
      await ytdlp.download(entry.youtube_id, dest);
      markStatus(db, entry.id, 'ready', { cache_path: dest } as any);
    } catch (err) {
      if (err instanceof BotChallengeError) {
        getBus().broadcast('bot_challenge', { detected_at: Date.now() });
      }
      markStatus(db, entry.id, 'failed', { fail_reason: (err as Error).message } as any);
    }
    getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
  }

  // Eviction: keep currently-playing entry's file.
  const current = getCurrent(db);
  const keep = new Set<string>();
  if (current?.youtube_id) keep.add(cache.pathFor(current.youtube_id));
  cache.evict(keep);
  if (cache.usedBytes() >= settings.cache_max_bytes) {
    getBus().broadcast('cache.full', { used_bytes: cache.usedBytes(), cap_bytes: settings.cache_max_bytes });
  }
}

export function kickWorker(): void {
  if (running) return;
  running = true;
  queueMicrotask(async () => {
    try { await runWorkerOnce(); }
    finally { running = false; }
  });
}
