# Bug-bash sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six state-correctness and UX-visible bugs in the stage/queue/veto subsystems in one coordinated PR.

**Architecture:** Surgical per-bug fixes with two pieces of new persistence — a `pending_vetos` table (survives restart, enables dedupe) and an `is_paused` column on the existing `stage_session` row (propagates pause state to phones). No new aggregates, no module-boundary refactor.

**Tech Stack:** Next.js 15 App Router, TypeScript, better-sqlite3, vitest. Server-Sent Events for live updates.

**Spec:** `docs/superpowers/specs/2026-05-16-bug-bash-sweep-design.md`

---

## File map

**Modify:**
- `src/lib/db.ts` — append migration string to `MIGRATIONS` array, bumping `user_version` from 1 to 2.
- `src/lib/queue.ts` — add `sweepOrphanPlaying(db)` helper.
- `src/lib/veto.ts` — rewrite `VetoStore` to be DB-backed with rehydrate, dedupe-on-same-action, replace-on-different-action.
- `src/lib/veto-singleton.ts` — pass `getDb()` into `VetoStore` constructor; call `rehydrate()` post-construction.
- `src/lib/stage.ts` — extend `StageSession` shape with `is_paused: boolean`; add `setPaused(db, paused)`; in `getActiveStage`, when the row exists but heartbeat is stale, delete it and call `sweepOrphanPlaying`.
- `src/app/api/stage/claim/route.ts` — call `sweepOrphanPlaying` after successful claim, before broadcast.
- `src/app/api/stage/action/route.ts` — return 409 from `play` if anything is already playing; persist `is_paused` via `setPaused` on pause/resume; include `paused` in `stage.action` broadcast.
- `src/app/api/queue/route.ts` — include `paused: boolean` in GET response (false if no active stage).
- `src/app/page.tsx` — extend `QueueState` type with `paused`; render a "Paused" pill in `NowPlayingCard` when paused; debounce 200ms the `stage.action` refresh handler.
- `src/app/stage/page.tsx` — add `started` state; render "Tap to start the show" overlay until first tap inside the claimed view; drop client-side autoplay double-fire concerns (now server-enforced).

**Create:**
- `tests/unit/queue-sweep.test.ts` — coverage for `sweepOrphanPlaying`.
- `tests/api/stage-claim-sweep.test.ts` — coverage for claim-time orphan recovery.

**Extend:**
- `tests/unit/veto.test.ts` — rehydrate, dedupe, replace, expired-on-boot.
- `tests/api/stage.test.ts` — `play` 409, `pause`/`resume` flips `is_paused`, GET `/api/queue` reflects `paused`.

---

## Task 1: `sweepOrphanPlaying` helper

**Files:**
- Modify: `src/lib/queue.ts`
- Test: `tests/unit/queue-sweep.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/queue-sweep.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus, findEntry, sweepOrphanPlaying } from '@/lib/queue';

describe('sweepOrphanPlaying', () => {
  beforeEach(() => { freshDb(); });

  it('flips a single playing entry to skipped and sets ended_at', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    const before = Date.now();

    const changed = sweepOrphanPlaying(db);

    expect(changed).toBe(1);
    const row = findEntry(db, e.id)!;
    expect(row.status).toBe('skipped');
    expect(row.ended_at).toBeGreaterThanOrEqual(before);
  });

  it('returns 0 when nothing is playing', () => {
    const db = freshDb();
    expect(sweepOrphanPlaying(db)).toBe(0);
  });

  it('does not touch queued/downloading/ready/played/failed', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const queued = enqueue(db, singer.id, { youtube_id: 'q', title: 'q', channel: null, duration_sec: null, thumbnail_url: null });
    const ready = enqueue(db, singer.id, { youtube_id: 'r', title: 'r', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, ready.id, 'ready');
    const played = enqueue(db, singer.id, { youtube_id: 'p', title: 'p', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, played.id, 'played');

    expect(sweepOrphanPlaying(db)).toBe(0);
    expect(findEntry(db, queued.id)!.status).toBe('queued');
    expect(findEntry(db, ready.id)!.status).toBe('ready');
    expect(findEntry(db, played.id)!.status).toBe('played');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/queue-sweep.test.ts`
Expected: FAIL with `sweepOrphanPlaying is not exported` (or similar import error).

- [ ] **Step 3: Add `sweepOrphanPlaying` to `src/lib/queue.ts`**

Append at the end of the file:

```ts
export function sweepOrphanPlaying(db: DB): number {
  const r = db.prepare(
    "UPDATE queue_entries SET status='skipped', ended_at=? WHERE status='playing'",
  ).run(Date.now());
  return r.changes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/queue-sweep.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Run the full suite to check for collateral**

Run: `npm test`
Expected: PASS — no other tests touched orphan playing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queue.ts tests/unit/queue-sweep.test.ts
git commit -m "feat(queue): add sweepOrphanPlaying helper for stage recovery"
```

---

## Task 2: Migration — `pending_vetos` table and `stage_session.is_paused`

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/db.test.ts` (or create if it doesn't have one for migrations). First check what's there:

Run: `cat tests/unit/db.test.ts`

If a migrations test already exists, append the case below; otherwise create the file with this content:

```ts
import { describe, it, expect } from 'vitest';
import { openMemoryDb } from '@/lib/db';

describe('schema migrations', () => {
  it('creates pending_vetos table', () => {
    const db = openMemoryDb();
    const cols = db.prepare("PRAGMA table_info(pending_vetos)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['action', 'created_at', 'entry_id', 'expires_at', 'id', 'singer_id']);
  });

  it('adds is_paused column to stage_session', () => {
    const db = openMemoryDb();
    const cols = db.prepare("PRAGMA table_info(stage_session)").all() as Array<{ name: string; dflt_value: string | null }>;
    const isPaused = cols.find((c) => c.name === 'is_paused');
    expect(isPaused).toBeDefined();
    expect(isPaused?.dflt_value).toBe('0');
  });

  it('bumps user_version to 2', () => {
    const db = openMemoryDb();
    const v = db.pragma('user_version', { simple: true }) as number;
    expect(v).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/db.test.ts`
Expected: FAIL — `pending_vetos` table doesn't exist, `is_paused` column missing, `user_version` is 1.

- [ ] **Step 3: Append a new migration string to `MIGRATIONS` in `src/lib/db.ts`**

In `src/lib/db.ts`, find the line `const MIGRATIONS: string[] = [SCHEMA_V1];` and replace with:

```ts
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS pending_vetos (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  singer_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_vetos_entry ON pending_vetos(entry_id);

ALTER TABLE stage_session ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
`;

// Append-only. Each entry is a SQL string applied once when user_version is below its index+1.
// Adding a new migration: push the next ALTER/CREATE here; never edit a past entry.
const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/db.test.ts`
Expected: PASS — all three migration cases.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — existing tests use `openMemoryDb` which re-runs migrations from scratch each test, so they all still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts tests/unit/db.test.ts
git commit -m "feat(db): migration for pending_vetos table and stage_session.is_paused"
```

---

## Task 3: DB-backed `VetoStore` with rehydrate, dedupe, replace

**Files:**
- Modify: `src/lib/veto.ts`
- Modify: `src/lib/veto-singleton.ts`
- Test: `tests/unit/veto.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

First, add an import at the top of `tests/unit/veto.test.ts` right after the existing imports:

```ts
import { openMemoryDb } from '@/lib/db';
```

Then append the following block inside the existing `describe('VetoStore', ...)` block, before the closing brace:

```ts
  // -- new persistence behavior --

  it('persists pending veto to the database', () => {
    const db = openMemoryDb();
    const store = new VetoStore((_e: any) => {}, db);
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    const row = db.prepare('SELECT * FROM pending_vetos WHERE id=?').get(v.id) as any;
    expect(row).toBeDefined();
    expect(row.action).toBe('restart');
    expect(row.entry_id).toBe('e1');
  });

  it('removes row on decide', () => {
    const db = openMemoryDb();
    const store = new VetoStore((_e: any) => {}, db);
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    store.decide(v.id, 'allow');
    const row = db.prepare('SELECT * FROM pending_vetos WHERE id=?').get(v.id);
    expect(row).toBeUndefined();
  });

  it('rehydrate schedules timers for unexpired rows', () => {
    const db = openMemoryDb();
    const events: any[] = [];
    const storeA = new VetoStore((e: any) => events.push(e), db);
    storeA.open({ action: 'skip', entry_id: 'e2', singer_id: 's2' });
    // Simulate restart: drop in-memory state by constructing a new store against the same db.
    const events2: any[] = [];
    const storeB = new VetoStore((e: any) => events2.push(e), db);
    storeB.rehydrate();
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    expect(events2.some((e) => e.kind === 'approved')).toBe(true);
  });

  it('rehydrate immediately approves rows already expired', () => {
    const db = openMemoryDb();
    db.prepare(
      'INSERT INTO pending_vetos (id, action, entry_id, singer_id, expires_at, created_at) VALUES (?,?,?,?,?,?)'
    ).run('v-expired', 'skip', 'e3', 's3', Date.now() - 1000, Date.now() - 2000);
    const events: any[] = [];
    const store = new VetoStore((e: any) => events.push(e), db);
    store.rehydrate();
    expect(events).toEqual([{ kind: 'approved', veto_id: 'v-expired', action: 'skip', entry_id: 'e3' }]);
    const row = db.prepare('SELECT * FROM pending_vetos WHERE id=?').get('v-expired');
    expect(row).toBeUndefined();
  });

  it('dedupes: same entry + same action returns the existing veto', () => {
    const db = openMemoryDb();
    const events: any[] = [];
    const store = new VetoStore((e: any) => events.push(e), db);
    const a = store.open({ action: 'skip', entry_id: 'e4', singer_id: 's4' });
    const b = store.open({ action: 'skip', entry_id: 'e4', singer_id: 's4' });
    expect(b.id).toBe(a.id);
    expect(events.filter((e) => e.kind === 'pending').length).toBe(1);
  });

  it('replaces on different action: clears old timer, emits new pending', () => {
    const db = openMemoryDb();
    const events: any[] = [];
    const store = new VetoStore((e: any) => events.push(e), db);
    const a = store.open({ action: 'restart', entry_id: 'e5', singer_id: 's5' });
    const b = store.open({ action: 'skip', entry_id: 'e5', singer_id: 's5' });
    expect(b.id).not.toBe(a.id);
    expect(events.filter((e) => e.kind === 'pending').length).toBe(2);
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    const approvals = events.filter((e) => e.kind === 'approved');
    expect(approvals.length).toBe(1);
    expect(approvals[0].action).toBe('skip');
    expect(approvals[0].veto_id).toBe(b.id);
  });
```

The existing tests in this file call `new VetoStore((e) => ...)` with a single arg. We're changing the constructor to take `(emit, db?)` where `db` is optional. With `db` absent, behavior is the same as today (in-memory only) so the existing tests pass unchanged.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/unit/veto.test.ts`
Expected: FAIL — `rehydrate` method missing, dedupe/replace not implemented, persistence missing.

- [ ] **Step 3: Rewrite `src/lib/veto.ts`**

Replace the entire file content with:

```ts
import { newId } from './ids';
import type { DB } from './db';

export const VETO_WINDOW_MS = 5_000;

export type VetoAction = 'restart' | 'skip';

export type PendingVeto = {
  id: string;
  action: VetoAction;
  entry_id: string;
  singer_id: string;
  expires_at: number;
};

export type VetoEvent =
  | { kind: 'pending'; veto: PendingVeto }
  | { kind: 'approved'; veto_id: string; action: VetoAction; entry_id: string }
  | { kind: 'denied'; veto_id: string };

export type Decision = 'allow' | 'deny';
export type DecideResult = 'approved' | 'denied' | 'unknown';

type Row = {
  id: string;
  action: VetoAction;
  entry_id: string;
  singer_id: string;
  expires_at: number;
  created_at: number;
};

export class VetoStore {
  private timers = new Map<string, NodeJS.Timeout>();
  private memory = new Map<string, PendingVeto>();

  constructor(private emit: (e: VetoEvent) => void, private db?: DB) {}

  open(input: { action: VetoAction; entry_id: string; singer_id: string }): PendingVeto {
    const existing = this.findByEntry(input.entry_id);
    if (existing) {
      if (existing.action === input.action) return existing;
      // Replace: same entry, different action.
      this.clearLocally(existing.id);
    }

    const id = newId();
    const veto: PendingVeto = {
      id,
      action: input.action,
      entry_id: input.entry_id,
      singer_id: input.singer_id,
      expires_at: Date.now() + VETO_WINDOW_MS,
    };
    this.persist(veto);
    this.schedule(veto);
    this.emit({ kind: 'pending', veto });
    return veto;
  }

  decide(id: string, decision: Decision): DecideResult {
    const v = this.lookup(id);
    if (!v) return 'unknown';
    this.clearLocally(id);
    if (decision === 'allow') {
      this.emit({ kind: 'approved', veto_id: id, action: v.action, entry_id: v.entry_id });
      return 'approved';
    }
    this.emit({ kind: 'denied', veto_id: id });
    return 'denied';
  }

  list(): PendingVeto[] {
    if (this.db) {
      const rows = this.db.prepare('SELECT * FROM pending_vetos').all() as Row[];
      return rows.map(rowToVeto);
    }
    return Array.from(this.memory.values());
  }

  rehydrate(): void {
    if (!this.db) return;
    const rows = this.db.prepare('SELECT * FROM pending_vetos').all() as Row[];
    const now = Date.now();
    for (const row of rows) {
      if (row.expires_at <= now) {
        this.db.prepare('DELETE FROM pending_vetos WHERE id=?').run(row.id);
        this.emit({ kind: 'approved', veto_id: row.id, action: row.action, entry_id: row.entry_id });
        continue;
      }
      this.schedule(rowToVeto(row));
    }
  }

  // -- internals --

  private lookup(id: string): PendingVeto | null {
    if (this.db) {
      const row = this.db.prepare('SELECT * FROM pending_vetos WHERE id=?').get(id) as Row | undefined;
      return row ? rowToVeto(row) : null;
    }
    return this.memory.get(id) ?? null;
  }

  private findByEntry(entryId: string): PendingVeto | null {
    if (this.db) {
      const row = this.db.prepare('SELECT * FROM pending_vetos WHERE entry_id=? LIMIT 1').get(entryId) as Row | undefined;
      return row ? rowToVeto(row) : null;
    }
    for (const v of this.memory.values()) if (v.entry_id === entryId) return v;
    return null;
  }

  private persist(v: PendingVeto): void {
    if (this.db) {
      this.db.prepare(
        'INSERT INTO pending_vetos (id, action, entry_id, singer_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(v.id, v.action, v.entry_id, v.singer_id, v.expires_at, Date.now());
    } else {
      this.memory.set(v.id, v);
    }
  }

  private schedule(v: PendingVeto): void {
    const delay = Math.max(0, v.expires_at - Date.now());
    const t = setTimeout(() => this.resolveApprove(v.id), delay);
    this.timers.set(v.id, t);
  }

  private clearLocally(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    if (this.db) {
      this.db.prepare('DELETE FROM pending_vetos WHERE id=?').run(id);
    } else {
      this.memory.delete(id);
    }
  }

  private resolveApprove(id: string): void {
    const v = this.lookup(id);
    if (!v) return;
    this.clearLocally(id);
    this.emit({ kind: 'approved', veto_id: id, action: v.action, entry_id: v.entry_id });
  }
}

function rowToVeto(r: Row): PendingVeto {
  return {
    id: r.id,
    action: r.action,
    entry_id: r.entry_id,
    singer_id: r.singer_id,
    expires_at: r.expires_at,
  };
}
```

- [ ] **Step 4: Run veto tests to verify they all pass**

Run: `npx vitest run tests/unit/veto.test.ts`
Expected: PASS — original 6 tests + 6 new tests.

- [ ] **Step 5: Update `src/lib/veto-singleton.ts` to inject db and rehydrate**

Replace the file content with:

```ts
import { VetoStore, type VetoEvent, type PendingVeto } from './veto';
import { getBus } from './sse';
import { getDb } from './db';
import { findEntry, markStatus, getActiveQueue, getCurrent } from './queue';
import { getSettings } from './settings';
import { updateLastSang, findById as findSinger } from './singers';

declare global {
  // eslint-disable-next-line no-var
  var __karaokeVetoStore: VetoStore | undefined;
}

function applyApproval(entryId: string, action: 'restart' | 'skip') {
  const db = getDb();
  const entry = findEntry(db, entryId);
  if (!entry) return;
  if (action === 'skip') {
    markStatus(db, entry.id, 'skipped');
    if (entry.singer.id) updateLastSang(db, entry.singer.id, Date.now());
  }
  const settings = getSettings(db);
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
}

function hydrateVeto(veto: PendingVeto) {
  const singer = findSinger(getDb(), veto.singer_id);
  return { ...veto, singer };
}

function emit(e: VetoEvent) {
  const bus = getBus();
  if (e.kind === 'pending') {
    bus.broadcast('veto.pending', { veto: hydrateVeto(e.veto) });
  } else if (e.kind === 'approved') {
    const singer = findSinger(getDb(), getApprovalSingerId(e.entry_id));
    bus.broadcast('veto.approved', { veto_id: e.veto_id, action: e.action, entry_id: e.entry_id, singer });
    applyApproval(e.entry_id, e.action);
  } else {
    bus.broadcast('veto.denied', { veto_id: e.veto_id });
  }
}

function getApprovalSingerId(entryId: string): string {
  const entry = findEntry(getDb(), entryId);
  return entry?.singer.id ?? '';
}

export function getVetoStore(): VetoStore {
  if (!globalThis.__karaokeVetoStore) {
    const store = new VetoStore(emit, getDb());
    store.rehydrate();
    globalThis.__karaokeVetoStore = store;
  }
  return globalThis.__karaokeVetoStore;
}

export function resetVetoStoreForTest(): void {
  globalThis.__karaokeVetoStore = undefined;
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — VetoStore singleton-using tests (api/veto.test.ts) still pass because rehydrate is a no-op on a freshly-migrated empty DB.

- [ ] **Step 7: Commit**

```bash
git add src/lib/veto.ts src/lib/veto-singleton.ts tests/unit/veto.test.ts
git commit -m "feat(veto): persist pending vetos, rehydrate on boot, dedupe-or-replace"
```

---

## Task 4: Orphan-playing sweep wired into claim and stale-stage read

**Files:**
- Modify: `src/lib/stage.ts`
- Modify: `src/app/api/stage/claim/route.ts`
- Test: `tests/api/stage-claim-sweep.test.ts` (new)
- Test: `tests/unit/stage.test.ts` (extend)

- [ ] **Step 1: Write the failing API test**

Create `tests/api/stage-claim-sweep.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest } from '../helpers/api-helpers';
import { POST as claimPOST } from '@/app/api/stage/claim/route';
import { enqueue, markStatus, findEntry } from '@/lib/queue';
import { registerGuest } from '@/lib/singers';

beforeEach(() => { freshDb(); });

describe('stage claim sweeps orphan playing rows', () => {
  it('flips a leftover playing entry to skipped when a new claim arrives', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');

    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-fresh' }),
    }));
    expect(res.status).toBe(200);
    expect(findEntry(db, e.id)!.status).toBe('skipped');
  });
});
```

- [ ] **Step 2: Write the failing unit test for stale-stage sweep**

First check the existing file to know which imports are already present:

Run: `cat tests/unit/stage.test.ts`

At the top of `tests/unit/stage.test.ts`, ensure these imports exist (add only the ones missing — do not duplicate):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { getActiveStage, claimStage, STAGE_HEARTBEAT_TTL_MS } from '@/lib/stage';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus, findEntry } from '@/lib/queue';
```

Then append this new `describe` block at the end of the file:

```ts
describe('getActiveStage stale-heartbeat sweep', () => {
  beforeEach(() => { freshDb(); });

  it('clears stale stage row and sweeps orphan playing entries', () => {
    const db = freshDb();
    claimStage(db, 'tab-a', false);
    db.prepare('UPDATE stage_session SET last_heartbeat=?').run(Date.now() - STAGE_HEARTBEAT_TTL_MS - 1);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');

    const active = getActiveStage(db);
    expect(active).toBeNull();

    expect(findEntry(db, e.id)!.status).toBe('skipped');
    const row = db.prepare('SELECT COUNT(*) AS c FROM stage_session').get() as { c: number };
    expect(row.c).toBe(0);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx vitest run tests/api/stage-claim-sweep.test.ts tests/unit/stage.test.ts`
Expected: FAIL — claim route doesn't sweep; `getActiveStage` returns null but leaves the row and the orphan entry intact.

- [ ] **Step 4: Update `src/lib/stage.ts`**

Replace the file content with:

```ts
import type { DB } from './db';
import { sweepOrphanPlaying } from './queue';

export const STAGE_HEARTBEAT_TTL_MS = 30_000;

export type StageSession = {
  tab_id: string;
  claimed_at: number;
  last_heartbeat: number;
  is_paused: boolean;
};

export type ClaimResult =
  | { kind: 'claimed'; session: StageSession; evicted: string | null }
  | { kind: 'conflict'; current: StageSession };

type Row = {
  tab_id: string;
  claimed_at: number;
  last_heartbeat: number;
  is_paused: number;
};

function rowToSession(r: Row): StageSession {
  return {
    tab_id: r.tab_id,
    claimed_at: r.claimed_at,
    last_heartbeat: r.last_heartbeat,
    is_paused: r.is_paused === 1,
  };
}

export function getActiveStage(db: DB): StageSession | null {
  const row = db.prepare('SELECT * FROM stage_session LIMIT 1').get() as Row | undefined;
  if (!row) return null;
  if (Date.now() - row.last_heartbeat > STAGE_HEARTBEAT_TTL_MS) {
    // Stale: clean up the dead session and any orphan playing entry.
    db.prepare('DELETE FROM stage_session WHERE tab_id=?').run(row.tab_id);
    sweepOrphanPlaying(db);
    return null;
  }
  return rowToSession(row);
}

export function claimStage(db: DB, tabId: string, force: boolean): ClaimResult {
  const current = getActiveStage(db);
  if (current && current.tab_id !== tabId && !force) {
    return { kind: 'conflict', current };
  }
  const evicted = current && current.tab_id !== tabId ? current.tab_id : null;
  db.prepare('DELETE FROM stage_session').run();
  const now = Date.now();
  db.prepare(
    'INSERT INTO stage_session (tab_id, claimed_at, last_heartbeat, is_paused) VALUES (?, ?, ?, 0)',
  ).run(tabId, now, now);
  return {
    kind: 'claimed',
    session: { tab_id: tabId, claimed_at: now, last_heartbeat: now, is_paused: false },
    evicted,
  };
}

export function heartbeat(db: DB, tabId: string): boolean {
  const r = db.prepare('UPDATE stage_session SET last_heartbeat=? WHERE tab_id=?').run(Date.now(), tabId);
  return r.changes > 0;
}

export function releaseStage(db: DB, tabId: string): boolean {
  const r = db.prepare('DELETE FROM stage_session WHERE tab_id=?').run(tabId);
  return r.changes > 0;
}

export function setPaused(db: DB, paused: boolean): boolean {
  const r = db.prepare('UPDATE stage_session SET is_paused=?').run(paused ? 1 : 0);
  return r.changes > 0;
}
```

- [ ] **Step 5: Update `src/app/api/stage/claim/route.ts` to sweep on successful claim**

Replace with:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { setCookieHeader } from '@/lib/api/cookies';
import { STAGE_TAB_COOKIE, COOKIE_MAX_AGE } from '@/lib/auth/session';
import { claimStage } from '@/lib/stage';
import { sweepOrphanPlaying } from '@/lib/queue';
import { getBus } from '@/lib/sse';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const tabId = body?.tab_id;
  if (typeof tabId !== 'string' || !tabId) return jsonError('bad_request', 'tab_id required', 400);

  const db = getDb();
  const r = claimStage(db, tabId, body?.force === true);
  if (r.kind === 'conflict') {
    return new Response(
      JSON.stringify({ error: 'stage already claimed', code: 'conflict', current: r.current }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    );
  }

  sweepOrphanPlaying(db);

  const bus = getBus();
  bus.broadcast('stage.claimed', { session: r.session });
  if (r.evicted) bus.broadcast('stage.evicted', { tab_id: r.evicted });
  return jsonOk({ ok: true }, {
    headers: { 'set-cookie': setCookieHeader(STAGE_TAB_COOKIE, tabId, { maxAge: COOKIE_MAX_AGE }) },
  });
}
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx vitest run tests/api/stage-claim-sweep.test.ts tests/unit/stage.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — note the existing `tests/unit/stage.test.ts` may have checked the old `StageSession` shape (without `is_paused`). If anything fails about missing `is_paused`, update those assertions to include `is_paused: false` for fresh claims.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stage.ts src/app/api/stage/claim/route.ts tests/unit/stage.test.ts tests/api/stage-claim-sweep.test.ts
git commit -m "feat(stage): sweep orphan playing rows on claim and on stale-heartbeat read"
```

---

## Task 5: `is_paused` plumbing — API and phone UI

**Files:**
- Modify: `src/app/api/stage/action/route.ts`
- Modify: `src/app/api/queue/route.ts`
- Modify: `src/app/page.tsx`
- Test: `tests/api/stage.test.ts` (extend)
- Test: `tests/api/queue.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/stage.test.ts` inside the existing `describe('POST /api/stage/action', ...)` block:

```ts
  it('pause flips is_paused and resume clears it', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-p' }),
    }));
    const pauseRes = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-p' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    }));
    expect(pauseRes.status).toBe(200);
    const paused = getDb().prepare('SELECT is_paused FROM stage_session').get() as { is_paused: number };
    expect(paused.is_paused).toBe(1);

    const resumeRes = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-p' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    }));
    expect(resumeRes.status).toBe(200);
    const resumed = getDb().prepare('SELECT is_paused FROM stage_session').get() as { is_paused: number };
    expect(resumed.is_paused).toBe(0);
  });
```

Append to `tests/api/queue.test.ts` (find the existing top-level `describe` for GET — read the file first if needed):

Run: `cat tests/api/queue.test.ts | head -40`

Then append a new case to whatever `describe('GET /api/queue', ...)` block exists; if there isn't one, add one:

```ts
import { POST as claimPOST } from '@/app/api/stage/claim/route';
import { POST as actionPOST } from '@/app/api/stage/action/route';
import { STAGE_TAB_COOKIE } from '@/lib/auth/session';

describe('GET /api/queue paused field', () => {
  it('returns paused:false by default', async () => {
    const res = await GET(makeRequest('/api/queue'));
    const body = await readJson(res);
    expect(body.paused).toBe(false);
  });

  it('returns paused:true after pause action', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-q' }),
    }));
    await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-q' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    }));
    const res = await GET(makeRequest('/api/queue'));
    const body = await readJson(res);
    expect(body.paused).toBe(true);
  });
});
```

If `GET` and helpers aren't already imported in the file, add the imports at the top following the existing patterns.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/api/stage.test.ts tests/api/queue.test.ts`
Expected: FAIL — `is_paused` not written; `paused` not in response.

- [ ] **Step 3: Update `src/app/api/stage/action/route.ts`**

Replace the file content with:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { getStageTab } from '@/lib/auth/session';
import { getActiveStage, setPaused } from '@/lib/stage';
import { getCurrent, markStatus, getActiveQueue, findEntry } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { updateLastSang } from '@/lib/singers';
import { getBus } from '@/lib/sse';

const ACTIONS = ['skip', 'restart', 'pause', 'resume', 'seek', 'play', 'finish'] as const;
type Action = typeof ACTIONS[number];

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  const cookies = cookiesFromRequest(req);
  const tabId = getStageTab(cookies);
  const active = getActiveStage(db);
  if (!tabId || !active || active.tab_id !== tabId) return jsonError('forbidden', 'not the active stage', 403);

  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const action = body?.action as Action;
  if (!ACTIONS.includes(action)) return jsonError('bad_request', 'invalid action', 400);

  const current = getCurrent(db);
  const bus = getBus();
  const settings = getSettings(db);

  if (action === 'skip') {
    if (current) markStatus(db, current.id, 'skipped');
  } else if (action === 'restart') {
    // Stage tab applies the actual seek client-side; server logs and broadcasts.
  } else if (action === 'pause') {
    setPaused(db, true);
  } else if (action === 'resume') {
    setPaused(db, false);
  } else if (action === 'seek') {
    // Stage tab is authoritative on the seek position.
  } else if (action === 'play') {
    if (current) {
      return jsonError('conflict', 'already playing', 409);
    }
    const entryId = body?.entry_id;
    if (typeof entryId !== 'string') return jsonError('bad_request', 'entry_id required', 400);
    const entry = findEntry(db, entryId);
    if (!entry) return jsonError('not_found', 'entry not found', 404);
    markStatus(db, entry.id, 'playing');
  } else if (action === 'finish') {
    if (current) {
      markStatus(db, current.id, 'played');
      updateLastSang(db, current.singer.id, Date.now());
    }
  }

  const updatedActive = getActiveStage(db);
  const paused = updatedActive?.is_paused ?? false;
  bus.broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db), paused });
  bus.broadcast('stage.action', { action, value: body.value ?? null, paused });
  return jsonOk({ ok: true });
}
```

This commit covers Task 6 (play 409) too — done inline because the action route is open for editing anyway. We'll keep them together in this commit.

- [ ] **Step 4: Update `src/app/api/queue/route.ts`**

Replace with:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { resolveSinger } from '@/lib/auth/session';
import { enqueue, getActiveQueue, getCurrent } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { getActiveStage } from '@/lib/stage';
import { getBus } from '@/lib/sse';
import { kickWorker } from '@/lib/worker/download-worker';

export async function GET(_req: Request): Promise<Response> {
  const db = getDb();
  const settings = getSettings(db);
  const entries = getActiveQueue(db, settings.queue_mode);
  const current = getCurrent(db);
  const active = getActiveStage(db);
  const paused = active?.is_paused ?? false;
  return jsonOk({ entries, current, mode: settings.queue_mode, paused });
}

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  const singer = await resolveSinger(db, cookiesFromRequest(req));
  if (!singer) return jsonError('unauthorized', 'register first', 401);
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const youtube_id = body?.youtube_id;
  const title = body?.title;
  if (typeof youtube_id !== 'string' || !youtube_id.trim()) return jsonError('bad_request', 'youtube_id required', 400);
  if (typeof title !== 'string' || !title.trim()) return jsonError('bad_request', 'title required', 400);
  const entry = enqueue(db, singer.id, {
    youtube_id,
    title,
    channel: typeof body.channel === 'string' ? body.channel : null,
    duration_sec: typeof body.duration_sec === 'number' ? body.duration_sec : null,
    thumbnail_url: typeof body.thumbnail_url === 'string' ? body.thumbnail_url : null,
  });
  kickWorker();
  const settings = getSettings(db);
  const active = getActiveStage(db);
  const paused = active?.is_paused ?? false;
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db), paused });
  return jsonOk({ entry });
}
```

- [ ] **Step 5: Update `src/app/page.tsx` — extend `QueueState`, render Paused pill, debounce stage.action refresh**

In `src/app/page.tsx`, find the `QueueState` type (around line 39) and replace:

Old:
```ts
type QueueState = { entries: QueueEntry[]; current: QueueEntry | null; mode: 'fifo' | 'round_robin' };
```

New:
```ts
type QueueState = { entries: QueueEntry[]; current: QueueEntry | null; mode: 'fifo' | 'round_robin'; paused: boolean };
```

In the same file, find the SSE setup inside the `useEffect` block (the lines starting `es.addEventListener('queue.updated', onUpdate);`). Replace the listener wiring so `stage.action` is debounced:

Old:
```ts
      const onUpdate = () => refreshRef.current();
      es.addEventListener('queue.updated', onUpdate);
      es.addEventListener('stage.action', onUpdate);
```

New:
```ts
      const onUpdate = () => refreshRef.current();
      let stageActionTimer: ReturnType<typeof setTimeout> | null = null;
      const onStageAction = () => {
        if (stageActionTimer) clearTimeout(stageActionTimer);
        stageActionTimer = setTimeout(() => refreshRef.current(), 200);
      };
      es.addEventListener('queue.updated', onUpdate);
      es.addEventListener('stage.action', onStageAction);
```

Update the cleanup return at the bottom of the same `useEffect` to clear the debounce timer. Find:

```ts
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
```

Replace with (note: `stageActionTimer` is scoped inside `connect`, so we cannot reach it from cleanup; rely on the EventSource close + cancelled flag to neuter the trailing fire — the timer's callback calls `refreshRef.current` which is harmless after unmount). Actually keep the cleanup as-is; the debounce timer fires at most once with a stale `refreshRef.current` invocation, which is a no-op when the component is unmounted.

Find `NowPlayingCard` and add the paused pill. Replace the call site (around line 247):

Old:
```tsx
        <NowPlayingCard current={current} upNext={upNext.length} />
```

New:
```tsx
        <NowPlayingCard current={current} upNext={upNext.length} paused={queue?.paused ?? false} />
```

Update the `NowPlayingCard` function signature (around line 269) to accept `paused`:

Old:
```tsx
function NowPlayingCard({
  current,
  upNext,
}: {
  current: QueueEntry | null;
  upNext: number;
}) {
```

New:
```tsx
function NowPlayingCard({
  current,
  upNext,
  paused,
}: {
  current: QueueEntry | null;
  upNext: number;
  paused: boolean;
}) {
```

Then in the same function, find the "Live stage" / "Stage idle" header line:

Old:
```tsx
        <div className="text-[11px] uppercase tracking-[0.22em] font-bold text-zinc-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)] pulse-soft" />
          {current ? 'Live stage' : 'Stage idle'}
        </div>
```

New:
```tsx
        <div className="text-[11px] uppercase tracking-[0.22em] font-bold text-zinc-400 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${paused ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.7)]' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)] pulse-soft'}`} />
          {current ? (paused ? 'Paused' : 'Live stage') : 'Stage idle'}
        </div>
```

Also freeze the equalizer bars when paused — find the eq-bar block in the same component:

Old:
```tsx
        {current && (
          <div className="flex items-end gap-1 h-4 text-emerald-400">
            <span className="eq-bar h-3" style={{ animationDuration: '1.1s' }} />
            <span className="eq-bar h-4" style={{ animationDuration: '0.8s', animationDelay: '0.1s' }} />
            <span className="eq-bar h-2.5" style={{ animationDuration: '1.4s', animationDelay: '0.2s' }} />
          </div>
        )}
```

New:
```tsx
        {current && !paused && (
          <div className="flex items-end gap-1 h-4 text-emerald-400">
            <span className="eq-bar h-3" style={{ animationDuration: '1.1s' }} />
            <span className="eq-bar h-4" style={{ animationDuration: '0.8s', animationDelay: '0.1s' }} />
            <span className="eq-bar h-2.5" style={{ animationDuration: '1.4s', animationDelay: '0.2s' }} />
          </div>
        )}
```

- [ ] **Step 6: Run the API tests to verify they pass**

Run: `npx vitest run tests/api/stage.test.ts tests/api/queue.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/stage/action/route.ts src/app/api/queue/route.ts src/app/page.tsx tests/api/stage.test.ts tests/api/queue.test.ts
git commit -m "feat(stage): persist is_paused, propagate to phones, reject play when already playing"
```

---

## Task 6: `play` idempotency 409 — verify and test

The implementation is already in Task 5's action-route rewrite. This task adds an explicit test.

**Files:**
- Test: `tests/api/stage.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append inside `describe('POST /api/stage/action', ...)`:

```ts
  it('returns 409 when play is requested while something is already playing', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const a = enqueue(db, singer.id, { youtube_id: 'a', title: 'a', channel: null, duration_sec: null, thumbnail_url: null });
    const b = enqueue(db, singer.id, { youtube_id: 'b', title: 'b', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, a.id, 'playing');
    markStatus(db, b.id, 'ready');
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'play', entry_id: b.id }),
    }));
    expect(res.status).toBe(409);
    expect(findEntry(db, b.id)!.status).toBe('ready');
  });
```

- [ ] **Step 2: Run the test to verify it passes (already implemented in Task 5)**

Run: `npx vitest run tests/api/stage.test.ts`
Expected: PASS — Task 5 already added the 409 branch.

If this test were authored before Task 5 it would have failed. Since Task 5 implemented the branch already, this test is a regression guard, not a TDD red-step.

- [ ] **Step 3: Commit**

```bash
git add tests/api/stage.test.ts
git commit -m "test(stage): regression test for play 409 when already playing"
```

---

## Task 7: "Tap to start the show" overlay on stage

**Files:**
- Modify: `src/app/stage/page.tsx`

No automated test — this is browser-gesture behavior. Manual verification only.

- [ ] **Step 1: Add a `started` state on the stage page**

In `src/app/stage/page.tsx`, near the other `useState` declarations in `StagePage` (around line 53–63), add:

```ts
  const [started, setStarted] = useState(false);
```

- [ ] **Step 2: Reset `started` when the claim is dropped**

In the same component, in the SSE `stage.evicted` handler, add `setStarted(false)`. Find:

```ts
      es.addEventListener('stage.evicted', (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          if (d?.tab_id === tabId) setClaimed(false);
        } catch {
          /* ignore */
        }
      });
```

Replace with:

```ts
      es.addEventListener('stage.evicted', (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          if (d?.tab_id === tabId) {
            setClaimed(false);
            setStarted(false);
          }
        } catch {
          /* ignore */
        }
      });
```

- [ ] **Step 3: Pass `started` + `setStarted` down to `ClaimedStage`**

At the `ClaimedStage` render (around line 207), replace:

Old:
```tsx
  return (
    <ClaimedStage
      tabId={tabId}
      queue={queue}
      pendingVeto={pendingVeto}
      vetoCountdown={vetoCountdown}
      videoRef={videoRef}
      paused={paused}
      progress={progress}
      onProgress={setProgress}
      onPausedChange={setPaused}
      onRefresh={refresh}
    />
  );
```

New:
```tsx
  return (
    <ClaimedStage
      tabId={tabId}
      queue={queue}
      pendingVeto={pendingVeto}
      vetoCountdown={vetoCountdown}
      videoRef={videoRef}
      paused={paused}
      progress={progress}
      onProgress={setProgress}
      onPausedChange={setPaused}
      onRefresh={refresh}
      started={started}
      onStart={() => {
        setStarted(true);
        videoRef.current?.play().catch(() => {});
      }}
    />
  );
```

- [ ] **Step 4: Gate autoplay-action effect on `started`**

Find the auto-start effect (around line 155):

Old:
```ts
  useEffect(() => {
    if (!claimed || !queue) return;
    if (queue.current) return;
    const next = queue.entries[0];
    if (!next) return;
    if (next.status !== 'ready' && next.status !== 'downloading' && next.status !== 'queued') return;
    fetch('/api/stage/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'play', entry_id: next.id }),
    }).catch(() => {});
  }, [claimed, queue]);
```

Replace with:

```ts
  useEffect(() => {
    if (!claimed || !started || !queue) return;
    if (queue.current) return;
    const next = queue.entries[0];
    if (!next) return;
    if (next.status !== 'ready' && next.status !== 'downloading' && next.status !== 'queued') return;
    fetch('/api/stage/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'play', entry_id: next.id }),
    }).catch(() => {});
  }, [claimed, started, queue]);
```

- [ ] **Step 5: Accept and render the overlay inside `ClaimedStage`**

Update the `ClaimedStage` props type (around line 306) to include `started` and `onStart`:

Old:
```tsx
function ClaimedStage({
  tabId,
  queue,
  pendingVeto,
  vetoCountdown,
  videoRef,
  paused,
  progress,
  onProgress,
  onPausedChange,
  onRefresh,
}: {
  tabId: string;
  queue: QueueState | null;
  pendingVeto: PendingVeto | null;
  vetoCountdown: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  paused: boolean;
  progress: { current: number; duration: number };
  onProgress: (p: { current: number; duration: number }) => void;
  onPausedChange: (b: boolean) => void;
  onRefresh: () => void;
}) {
```

New:
```tsx
function ClaimedStage({
  tabId,
  queue,
  pendingVeto,
  vetoCountdown,
  videoRef,
  paused,
  progress,
  onProgress,
  onPausedChange,
  onRefresh,
  started,
  onStart,
}: {
  tabId: string;
  queue: QueueState | null;
  pendingVeto: PendingVeto | null;
  vetoCountdown: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  paused: boolean;
  progress: { current: number; duration: number };
  onProgress: (p: { current: number; duration: number }) => void;
  onPausedChange: (b: boolean) => void;
  onRefresh: () => void;
  started: boolean;
  onStart: () => void;
}) {
```

- [ ] **Step 6: Render the overlay**

At the very end of `ClaimedStage`'s returned JSX, just before the closing `</main>` tag, insert:

```tsx
      {!started && (
        <button
          type="button"
          onClick={onStart}
          className="fixed inset-0 z-40 grid place-items-center bg-black/85 backdrop-blur-md text-center"
        >
          <div className="flex flex-col items-center gap-3 px-8">
            <span className="text-[11px] uppercase tracking-[0.28em] text-zinc-400 font-semibold">
              Ready
            </span>
            <span className="text-4xl md:text-5xl font-medium tracking-tight text-gradient-soft">
              Tap to start the show
            </span>
            <span className="text-sm text-zinc-500 font-light max-w-md mt-2">
              One tap unlocks autoplay for this tab. After that, every queued song will play automatically.
            </span>
          </div>
        </button>
      )}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — no test touches the overlay; existing stage page tests are unaffected (they only test API routes, not the React component).

- [ ] **Step 9: Manual verification**

Run: `npm run dev` and open two browsers:
1. Stage on `http://localhost:3000/stage`. Claim. Verify the "Tap to start the show" overlay appears.
2. Phone on `http://localhost:3000`. Register. Queue a song.
3. Back on stage, tap the overlay. The first song plays.
4. Queue a second song from the phone — it plays automatically when the first ends.
5. Pause the song from the operator panel. Phone shows "Paused" pill within ~1s. Resume — both go back to "Live".
6. Refresh the stage tab mid-song. Verify it returns to the claim screen, then the "Tap to start" overlay again, then the song resumes (or is skipped after the orphan sweep on re-claim).

- [ ] **Step 10: Commit**

```bash
git add src/app/stage/page.tsx
git commit -m "feat(stage): tap-to-start overlay unlocks autoplay for the tab"
```

---

## Self-review checklist (for the executor — informational)

Before marking the plan done, the executor should verify:

- All six bugs from the spec have at least one task and at least one test (manual is acceptable for bug 6).
- `user_version` ends at 2 (verify in db migration test).
- `npm test` passes from a clean checkout.
- `npx tsc --noEmit` passes.
- Manual smoke test from Task 7 step 9 completes without surprises.
