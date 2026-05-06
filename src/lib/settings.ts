import type { DB } from './db';

export type QueueMode = 'fifo' | 'round_robin';

export type Settings = {
  queue_mode: QueueMode;
  stage_immersive: boolean;
  cache_max_bytes: number;
};

export function getSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    queue_mode: (m.get('queue_mode') as QueueMode) ?? 'fifo',
    stage_immersive: m.get('stage_immersive') === '1',
    cache_max_bytes: Number(m.get('cache_max_bytes') ?? 5 * 1024 * 1024 * 1024),
  };
}

export function updateSettings(db: DB, patch: Partial<{ queue_mode: QueueMode; stage_immersive: boolean; cache_max_bytes: number }>): Settings {
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  if (patch.queue_mode !== undefined) {
    if (patch.queue_mode !== 'fifo' && patch.queue_mode !== 'round_robin') throw new Error('invalid queue_mode');
    set.run('queue_mode', patch.queue_mode);
  }
  if (patch.stage_immersive !== undefined) set.run('stage_immersive', patch.stage_immersive ? '1' : '0');
  if (patch.cache_max_bytes !== undefined) {
    if (!Number.isFinite(patch.cache_max_bytes) || patch.cache_max_bytes <= 0) throw new Error('invalid cache_max_bytes');
    set.run('cache_max_bytes', String(patch.cache_max_bytes));
  }
  return getSettings(db);
}
