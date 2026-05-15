# Bug-bash sweep — stage state correctness

**Status:** Draft
**Date:** 2026-05-16
**Scope:** Six state-correctness and UX-visible bugs in the stage/queue/veto subsystems, fixed in one coordinated change.

## Motivation

The phone/stage pair drifts out of sync in several scenarios that real party use will trigger: duplicate play calls during SSE storms, abandoned `playing` rows after a stage tab dies, vetos lost on server restart, stacked veto requests, pause state invisible to phones, and silent `<video>` failures from browser autoplay blocking. Each bug is small in isolation; together they make the stage feel unreliable.

## Approach

Surgical per-bug fixes, with two pieces of persistence (`pending_vetos` table, `is_paused` column on `stage_session`) co-designed so they share SSE plumbing and a single migration. One PR, grouped commits per bug. No new aggregate types, no refactor of the existing stage/queue/veto module boundaries.

## Bugs and fixes

### 1. Stage auto-play double-fires

**Symptom.** `src/app/stage/page.tsx` runs an effect that issues `POST /api/stage/action {action:'play'}` whenever `queue` updates and `queue.current` is null. Any SSE event during the play round-trip (singer enqueue, download status change) re-fires the effect with the same `next.id`. Server processes `play` twice, marks the entry `playing` twice, broadcasts redundant `queue.updated`.

**Fix.** Server-side idempotency in `src/app/api/stage/action/route.ts`: when `action === 'play'`, return `409 {error: 'conflict', message: 'already playing'}` if any entry has `status='playing'`. The client effect can remain naive — the second call becomes a harmless 409.

### 2. Orphan `playing` row after a stage tab dies

**Symptom.** Browser closes, laptop sleeps, network drops past heartbeat TTL. `stage_session.last_heartbeat` goes stale (`STAGE_HEARTBEAT_TTL_MS = 30_000`), `getActiveStage` returns null, but `queue_entries.status='playing'` row for the half-sung song is untouched. Next stage claim renders, autoplay effect bails on `queue.current` being non-null, queue freezes.

**Fix.** New helper in `src/lib/queue.ts`:
```ts
export function sweepOrphanPlaying(db: DB): number {
  const r = db.prepare(
    "UPDATE queue_entries SET status='skipped', ended_at=? WHERE status='playing'"
  ).run(Date.now());
  return r.changes;
}
```

Call sites:
- `src/app/api/stage/claim/route.ts` — after successful `claimStage`, before the `queue.updated` broadcast. Sweeps on takeover.
- `src/lib/stage.ts` — in `getActiveStage`, when the row exists but heartbeat is stale, delete the stale row AND call `sweepOrphanPlaying(db)` in the same transaction. Sweeps lazily on the first read after a dead stage.

The lazy sweep guarantees recovery even if no one immediately re-claims.

### 3. Pending vetos lost on server restart

**Symptom.** `VetoStore` holds vetos in a `Map` + `setTimeout`. `npm run dev`'s HMR restart or a prod restart drops everything. The singer's "Skip requested" UI never resolves; the stage never gets `veto.approved`; the song plays forever (or until the operator hits Skip).

**Fix.** Persist pending vetos.

**Schema migration (append a new SQL string to `MIGRATIONS` in `src/lib/db.ts`):**
```sql
CREATE TABLE IF NOT EXISTS pending_vetos (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  singer_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_vetos_entry ON pending_vetos(entry_id);
```

**`src/lib/veto.ts`** — `VetoStore` becomes DB-backed:
- Constructor takes `(db, emit)`.
- `open()` inserts a row, schedules a `setTimeout` keyed by `id`, returns the veto.
- `decide()` deletes the row, clears the timer, emits.
- New `rehydrate()` reads all rows on first construction. For each row: if `expires_at <= Date.now()`, immediately call the internal approve path (delete row, emit `approved`). Otherwise schedule `setTimeout` for the remaining delta.
- The in-memory timer map remains an implementation detail; the table is the source of truth.

**`src/lib/veto-singleton.ts`** — pass `getDb()` into the `VetoStore` constructor and call `rehydrate()` immediately after creation. The singleton's globalThis stash continues to survive HMR; rehydrate also covers the cold-start case.

### 4. Stacked vetos for the same entry

**Symptom.** `singer/action` opens a fresh veto every call. A singer rapid-tapping Skip then Restart creates two pending vetos; both auto-approve in sequence (skip wins, but restart still fires `approved` against a no-longer-current entry).

**Fix.** In `VetoStore.open`, before insert:
1. Look up existing veto by `entry_id`.
2. If found and `action` matches → return the existing veto unchanged (idempotent double-tap).
3. If found and `action` differs → `clearTimeout` the old timer, delete the old row, insert the new one, emit a fresh `pending` (the previous countdown is replaced). Semantically: "I changed my mind — skip instead of restart" is a real intent; double-tapping the same button isn't.

### 5. Pause state never propagates to phones

**Symptom.** `POST /api/stage/action` with `pause`/`resume` is a no-op on the server (comment: "stage tab is authoritative"). Phones have no way to know the song is paused. The phone UI shows the live equalizer and "Live stage" pill while nothing is playing.

**Fix.**

**Schema migration:** append to the same new migration string:
```sql
ALTER TABLE stage_session ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
```

**`src/lib/stage.ts`:**
- Add `setPaused(db, paused: boolean): void` that updates the (single) row.
- Extend `StageSession` type with `is_paused: boolean` and include it in `getActiveStage`'s return shape (convert int↔bool at the boundary).

**`src/app/api/stage/action/route.ts`:** for `action === 'pause'`/`'resume'`, call `setPaused(db, action === 'pause')`. The existing `stage.action` broadcast payload gains `paused: boolean` (sourced from the active stage row).

**`src/app/api/queue/route.ts`:** GET response gains `paused: boolean` (false if no active stage). This is the source of truth for phones that connect mid-pause.

**`src/app/page.tsx`:** `QueueState` type gains `paused`. `NowPlayingCard` shows a "Paused" pill (and freezes the eq bars) when `paused && current` is true. Throttle the `stage.action` SSE refresh to debounce(200ms) since pause/resume traffic increases — the existing `queue.updated` event already covers content changes.

### 6. Stage `<video autoPlay>` blocked by browser

**Symptom.** Chromium blocks autoplay without a prior user gesture. The first song after a fresh stage claim silently fails to play; UI shows "Live stage" with `<video>` paused. Restart and pause buttons work because they originate in user gestures.

**Fix.** Convert the post-claim moment into an explicit "Start the show" gesture step.

State change in `src/app/stage/page.tsx`:
- Add `started: boolean` state (false after claim, true after the user taps "Start").
- When `claimed && !started`, render a full-cover overlay inside `ClaimedStage` (above the `<video>` area): "Tap to start the show". On click: set `started = true`. The first `play()` call now happens in user-gesture context, which unlocks autoplay for the rest of the tab's lifetime.
- The autoplay effect (and the `<video autoPlay>` attribute) only takes effect once `started` is true.
- `started` persists for the lifetime of the tab; it does NOT need to survive refresh.

## Out of scope

- Force-claim confirmation UI (bug 8 in the audit) — separate small change.
- Duplicate-queue guard (bug 9), failed-download retry (bug 10), cache eviction keep-set (bug 11) — separate PRs after this one lands.
- Any new feature work (you're-up cue, pitch control, etc.).
- Refactor of `stage_session` into a richer state-machine aggregate.

## Data model summary

One append-only migration (`MIGRATIONS[1]` in `src/lib/db.ts`):
1. `CREATE TABLE pending_vetos` + index.
2. `ALTER TABLE stage_session ADD COLUMN is_paused`.

No other schema changes. `user_version` bumps from 1 to 2.

## API/SSE contract changes

- `POST /api/stage/action {action:'play'}` → `409 conflict` when something already plays.
- `POST /api/stage/action {action:'pause'|'resume'}` → persists `is_paused` server-side.
- `GET /api/queue` response shape gains `paused: boolean`.
- `stage.action` SSE event payload gains `paused: boolean`.
- New event semantics: `veto.approved` and `veto.pending` may fire on cold-boot for rehydrated vetos that were already pending or expired before restart.

## Test plan

Vitest suites under `tests/`:

**`tests/veto.test.ts`** (new + extend existing):
- Rehydrate: open veto, simulate restart by reconstructing `VetoStore` against the same DB, assert timer fires and emits approved.
- Rehydrate of already-expired: row with `expires_at < now` resolves to approved immediately on construct.
- Dedupe same action: open(skip) → open(skip) returns same id, no second `pending` emit.
- Replace on different action: open(restart) → open(skip) clears first timer, emits new `pending`, only the second auto-approves.

**`tests/queue.test.ts`** (extend):
- `sweepOrphanPlaying` flips `playing`→`skipped` and sets `ended_at`; returns count.
- Leaves other statuses untouched.

**`tests/api/stage-action.test.ts`** (extend or new):
- `play` returns 409 when a `playing` entry exists.
- `pause` then `resume` flips `is_paused` in `stage_session`; `GET /api/queue` reflects it.

**`tests/api/stage-claim.test.ts`** (extend):
- Claim with an orphan `playing` entry → entry becomes `skipped`, broadcast carries fresh current=null.

**Manual checks (not automated):**
- Two tabs at `/`, one at `/stage` — pause on stage, both phones show "Paused" pill within 1s.
- Fresh stage claim → "Tap to start" overlay → tap → first song plays.
- Kill stage tab mid-song; wait 35s; re-claim — queue advances cleanly.
- `npm run dev`, open a veto, restart dev server within 5s, observe stage receives `veto.approved` from rehydrate.

## Risk

- Migration is additive and safe to run against existing prod DBs.
- Rehydrating expired vetos on cold boot may surprise singers whose veto from before the restart "took effect" after restart. Acceptable — better than the current behavior of never resolving.
- The "Tap to start" overlay adds one tap to claim flow. Worth it for reliable autoplay.

## Rollout

Single PR, six commits matched to the six bugs in this order:
1. `sweepOrphanPlaying` helper + tests.
2. Migration: `pending_vetos` + `is_paused` column.
3. DB-backed `VetoStore` with rehydrate + dedupe.
4. `is_paused` plumbing (lib/stage → API → phone UI).
5. `play` idempotency 409.
6. "Tap to start" overlay.

Each commit keeps the test suite green.
