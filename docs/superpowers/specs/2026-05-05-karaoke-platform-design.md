# Karaoke Platform — Design

**Status:** Draft
**Date:** 2026-05-05
**Sibling project of:** `fun-stuff/deejay`

## Purpose

A self-hosted karaoke platform for parties and offices. Anyone in the room — signed in or not — can search YouTube for karaoke videos, queue them under their name, and sing. One designated browser tab acts as the "stage" (TV/projector), playing video with lyrics. Borrows architecture and patterns from deejay; replaces deejay's audio-only Spotify/YouTube hybrid with video-only YouTube via yt-dlp.

## Scope of this spec

**This spec covers the backend and API layer only.** Library functions, route handlers, SSE event contracts, persistence, and yt-dlp orchestration must be production-quality and fully tested. **UI implementation is explicitly out of scope** and will be built by a separate agent against the API contract defined here. The Next.js `page.tsx` files referenced in the module layout exist as minimal scaffolds (enough to verify routing) — their visual/interaction design lives in a future UI spec.

The decisions captured below about stage UX (intro splash, immersive toggle, persistent sidebar) are recorded as **product intent** so the future UI agent has direction; the API/library deliverables here support all of them but do not implement them.

## Non-goals

- Pitch/key/tempo shifting of the source video.
- Microphone input, scoring, or audio mixing.
- Multi-room / multi-stage support (one stage tab at a time).
- A curated catalog independent of YouTube.
- Native apps; this is browser-only.
- **UI styling, layout, animations, or visual design** (deferred to UI agent).

## Key decisions (from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Project structure | New project at `fun-stuff/karaoke`, sibling of deejay. Borrows patterns; not a fork. |
| 2 | Queue model | Toggle between FIFO and round-robin (by singer). |
| 3 | Singer identity | Lightweight registration. Members auto-tagged via OIDC. Guests claim a display name once, stored in cookie. Members ≡ guests in permissions; sign-in only buys persistent identity across sessions. |
| 4 | Search bias | Auto-append "karaoke" to YouTube queries. Skip the append if user already typed "karaoke" (case-insensitive). |
| 5 | Stage tab UX (product intent for future UI agent) | Persistent sidebar (queue + current singer) + intro splash between songs ("Now performing: …"). Toggle: **immersive mode** hides everything, pure video. API exposes the data and `stage_immersive` setting; rendering is the UI agent's job. |
| 6 | yt-dlp handling | Pre-download next-up (and beyond) to local cache; serve as files. Fallback to streamed signed URL if file isn't ready. |
| 7 | Playback controls | Stage tab has full direct control. Current singer can request restart/skip via veto window. Everyone else is read-only on playback. |
| 8 | Veto window | 5 seconds. Auto-approve on stage-tab silence. Stage tab actions skip veto entirely. |

## Architecture

Single Next.js 15 (App Router) application running on a LAN host. SQLite (`better-sqlite3`) for state. Server-Sent Events for realtime sync. yt-dlp invoked as a subprocess for search, resolve, and download. HTML5 `<video>` for playback. Optional OIDC for member sign-in.

### Surfaces

- **Server (this spec)** — Next.js API routes + library modules. Owns queue state, SSE broadcast, yt-dlp orchestration, cache eviction, veto state machine. Fully implemented + tested.
- **Stage tab** at `/stage` (future UI work) — fullscreen video on TV/projector; consumes the stage-side API. This spec ships a minimal scaffold page that verifies the API contract end-to-end (e.g., a debug page with raw event log + buttons) but no production UI.
- **Phone tab** at `/` (future UI work) — search, queue, register name, singer controls; consumes the phone-side API. Same scaffold treatment.

## Data model (SQLite)

```sql
CREATE TABLE singers (
  id TEXT PRIMARY KEY,            -- uuid
  display_name TEXT NOT NULL,
  oidc_sub TEXT UNIQUE,           -- nullable; populated for members
  cookie_token TEXT UNIQUE,       -- nullable; populated for guests
  created_at INTEGER NOT NULL,
  last_sang_at INTEGER            -- updated when one of their entries finishes 'playing'
);

CREATE TABLE queue_entries (
  id TEXT PRIMARY KEY,
  singer_id TEXT NOT NULL REFERENCES singers(id),
  youtube_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT,
  duration_sec INTEGER,
  thumbnail_url TEXT,
  status TEXT NOT NULL,           -- 'queued' | 'downloading' | 'ready' | 'playing' | 'played' | 'skipped' | 'failed'
  cache_path TEXT,                -- absolute path once downloaded
  fail_reason TEXT,
  enqueued_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  position INTEGER NOT NULL       -- monotonic insertion index, used for FIFO; ignored by round-robin projection
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- known keys:
--   queue_mode      : 'fifo' | 'round_robin'   (default 'fifo')
--   stage_immersive : '0' | '1'                (default '0')
--   cache_max_bytes : integer string           (default '5368709120' = 5 GB)

CREATE TABLE stage_session (
  tab_id TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL
);
-- at most one row; rows older than 30s past last_heartbeat are considered stale
```

**Round-robin** is a read-time projection over `queue_entries WHERE status IN ('queued','downloading','ready')`, not a stored ordering — a singer joining mid-session immediately gets a fair slot without rewriting positions.

Projection algorithm:

1. Group pending entries by `singer_id`, each group ordered by `position` (enqueue order).
2. Order singers by `last_sang_at ASC NULLS FIRST` — singers who haven't sung yet (or sang longest ago) come first.
3. Take one entry per singer in that order, then loop. Repeat until all groups are exhausted.

## Modules

```
src/
  app/
    page.tsx                      # SCAFFOLD ONLY — debug UI to exercise phone API; production UI deferred
    stage/page.tsx                # SCAFFOLD ONLY — debug UI to exercise stage API; production UI deferred
    api/
      search/route.ts             # GET — yt-dlp search
      queue/
        route.ts                  # GET (snapshot), POST (enqueue)
        [id]/route.ts             # DELETE (remove a queued/ready entry)
        stream/route.ts           # GET — SSE
      stage/
        claim/route.ts            # POST — claim stage role
        release/route.ts          # POST — release stage role
        heartbeat/route.ts        # POST — keepalive
        action/route.ts           # POST — operator: skip/restart/pause/resume/seek
      singer/
        route.ts                  # POST — register/update name (sets cookie)
        action/route.ts           # POST — current singer requests skip or restart
      veto/[id]/route.ts          # POST — stage operator allows/denies a singer request
      cache/[id]/route.ts         # GET — serves downloaded mp4 to <video> with Range support
      settings/route.ts           # GET, PUT — queue_mode, immersive, cache cap
  lib/
    db.ts                         # better-sqlite3 singleton, migrations
    queue.ts                      # enqueue, advance, projection (fifo|rr)
    sse.ts                        # broadcast bus, per-connection writer registry
    ytdlp/
      search.ts                   # `yt-dlp ytsearch10:<q> --dump-json --flat-playlist`
      resolve.ts                  # `yt-dlp -g <url>` → signed URL (fallback)
      download.ts                 # `yt-dlp -f mp4 -o data/cache/<id>.mp4 <url>` (worker)
      detect.ts                   # bot-challenge detection from stderr
    cache.ts                      # LRU eviction by status='played' first, then size cap
    auth/
      oidc.ts                     # optional OIDC flow
      session.ts                  # cookie session for both members and guests
    veto.ts                       # pending-veto state machine, 5s timer
    search-query.ts               # normalize: append "karaoke" with dedup
```

Each module has a single job. yt-dlp is wrapped behind an interface so tests can fake it. Queue logic is pure and testable without subprocesses or filesystem.

## Key flows

### Search → enqueue

1. Phone: `GET /api/search?q=<query>`.
2. Server normalizes query via `search-query.normalize()`: appends `karaoke` unless already present (case-insensitive whole-word match).
3. Runs `yt-dlp ytsearch10:<normalized_q> --dump-json --flat-playlist`. Returns `[{youtube_id, title, channel, duration, thumbnail}]`.
4. Phone: `POST /api/queue` with `{youtube_id, title, channel, duration_sec, thumbnail_url}`. Server resolves the singer (OIDC sub or cookie token; if neither, returns 412 with prompt to register).
5. Server inserts row with `status='queued'`, broadcasts `queue.updated` SSE event.
6. Download worker picks up `queued` rows in `position ASC`, flips them to `downloading`, runs yt-dlp, flips to `ready` (or `failed` with `fail_reason`). Broadcasts after each transition.

### Singer registration

1. Phone with no session calls `POST /api/singer` with `{display_name}`.
2. Server creates `singers` row with new `cookie_token`, sets cookie. Returns `{id, display_name}`.
3. Phone with OIDC member session: server upserts `singers` row keyed on `oidc_sub` (display name from OIDC profile, editable by user later via same endpoint).

### Playback (stage tab)

1. On `/stage` mount, claim stage via `POST /api/stage/claim` (returns 409 if active stage exists; UI offers "force claim" which bumps the existing tab on user confirm).
2. Subscribe to SSE. On every `queue.updated`, recompute the active queue (projection per current `queue_mode`).
3. Pull "next" entry. If `status='ready'`, render intro splash for 3s then `<video src="/api/cache/{id}" autoplay>`. If `status='queued'|'downloading'`, show "Downloading…" splash and wait for SSE update.
4. On `ended` event: mark entry `status='played'`, set `ended_at`, update `singers.last_sang_at` for that singer, advance.
5. On `error` event from `<video>`: log, attempt fallback to streamed URL via `GET /api/cache/{id}?fallback=1` which 302s to a fresh `yt-dlp -g` resolve. If fallback also errors, mark `status='failed'` and advance.
6. Heartbeat every 10s via `POST /api/stage/heartbeat`.

### Singer veto flow

1. Current singer's phone: `POST /api/singer/action` with `{action: 'restart'|'skip', entry_id}`. Server validates that the requesting singer matches the currently `playing` entry's `singer_id`.
2. Server creates an in-memory pending veto: `{id, action, entry_id, expires_at: now + 5s}`. Broadcasts `veto.pending` SSE event with the pending record.
3. Stage tab renders a toast: "Angelo wants to restart — [Allow] [Veto] (5…4…3…)".
4. Stage tab: `POST /api/veto/{id}` with `{decision: 'allow'|'deny'}`. OR the 5s timer elapses with no response.
5. Server resolves the veto:
   - `allow` or timeout → broadcast `veto.approved`. Stage tab applies action: `restart` seeks `<video>` to 0; `skip` marks entry `skipped` and advances.
   - `deny` → broadcast `veto.denied`. Singer's phone shows "Vetoed by stage" toast.

### Operator (stage tab) actions

`POST /api/stage/action` with `{action: 'skip'|'restart'|'pause'|'resume'|'seek', value?}`. No veto path — applied immediately. Authorization: must include the active stage `tab_id` cookie/header.

### Queue mode toggle

`PUT /api/settings` with `{queue_mode: 'fifo'|'round_robin'}`. Anyone can change it (no member-only restriction, per Decision #3). Broadcast `settings.updated`. Stage and phones recompute display from the same projection on next render.

## Error handling

- **yt-dlp bot challenge** — `ytdlp/detect.ts` matches known stderr substrings ("Sign in to confirm you're not a bot", "HTTP Error 429", etc.). Server surfaces a banner: "YouTube is challenging downloads — set `YTDLP_COOKIES_FILE`". Already-cached songs keep playing.
- **Download fails** — entry stays at `status='failed'` with `fail_reason`. Stage tab shows a brief "Couldn't load — skipped" overlay and advances. Singer's phone gets a notice with a "retry" button (which re-enqueues the same `youtube_id`).
- **Stage tab disconnects** — heartbeat lapses past 30s. Active row cleared. Phones show banner: "No stage — open `/stage` on the TV to resume". Currently `playing` entry stays as `playing` until a new stage tab claims and either resumes or skips it.
- **Singer cookie lost** — registration prompt re-appears on next interaction. Old queue entries retain their original `singer_id`, so the orphaned name still appears in the queue.
- **Disk cap hit** — `cache.ts` evicts files in this order: oldest `played`, then oldest `skipped`/`failed`, then refuse new downloads. Surfaces a UI banner with current usage.
- **Two stage claim attempts** — second claimer gets 409 + current claim metadata; UI offers "force claim" that bumps the existing tab via SSE event `stage.evicted`.

## Configuration

```env
# yt-dlp
YTDLP_BIN=yt-dlp                    # path or command
YTDLP_COOKIES_FILE=                 # optional Netscape cookies for bot-challenge bypass
CACHE_DIR=./data/cache              # where mp4s land
CACHE_MAX_BYTES=5368709120          # 5 GB default

# OIDC (all optional; if unset, sign-in is disabled and everyone is a guest)
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=

# App
SESSION_SECRET=                     # openssl rand -hex 32
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

## API contract (for future UI agent)

This is the public surface the UI agent will plug into. All request/response bodies are JSON unless noted. All routes are under `/api`. Errors return `{error: string, code: string}` with appropriate HTTP status.

### REST endpoints

| Method & Path | Body / Query | Response | Auth |
|---|---|---|---|
| `GET /api/search?q=` | query string | `{results: SearchResult[]}` | session |
| `GET /api/queue` | — | `{entries: QueueEntry[], mode: 'fifo'\|'round_robin', current: QueueEntry\|null}` | session |
| `POST /api/queue` | `{youtube_id, title, channel?, duration_sec?, thumbnail_url?}` | `{entry: QueueEntry}` | singer |
| `DELETE /api/queue/:id` | — | `{ok: true}` | singer (own entry) or stage |
| `GET /api/queue/stream` | — | SSE stream (events below) | session |
| `POST /api/singer` | `{display_name}` | `{singer: Singer}` (sets cookie) | none |
| `GET /api/singer/me` | — | `{singer: Singer\|null}` | none |
| `POST /api/singer/action` | `{action: 'restart'\|'skip', entry_id}` | `{veto_id}` | singer (must match playing entry) |
| `POST /api/stage/claim` | `{tab_id, force?: boolean}` | `{ok: true}` or 409 `{current: StageSession}` | session |
| `POST /api/stage/release` | `{tab_id}` | `{ok: true}` | stage |
| `POST /api/stage/heartbeat` | `{tab_id}` | `{ok: true}` | stage |
| `POST /api/stage/action` | `{action, value?}` | `{ok: true}` | stage |
| `POST /api/veto/:id` | `{decision: 'allow'\|'deny'}` | `{ok: true}` | stage |
| `GET /api/settings` | — | `{queue_mode, stage_immersive, cache_max_bytes}` | session |
| `PUT /api/settings` | partial settings object | `{settings}` | session |
| `GET /api/cache/:id` | optional `?fallback=1` | mp4 bytes (Range supported) or 302 to signed URL | session |

### Type shapes

```ts
type SearchResult = {
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
};

type Singer = {
  id: string;
  display_name: string;
  is_member: boolean;     // true if oidc_sub set
};

type QueueEntry = {
  id: string;
  singer: Singer;
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
  status: 'queued' | 'downloading' | 'ready' | 'playing' | 'played' | 'skipped' | 'failed';
  fail_reason: string | null;
  enqueued_at: number;    // unix ms
  started_at: number | null;
  ended_at: number | null;
};

type StageSession = {
  tab_id: string;
  claimed_at: number;
  last_heartbeat: number;
};

type PendingVeto = {
  id: string;
  action: 'restart' | 'skip';
  entry_id: string;
  singer: Singer;
  expires_at: number;     // unix ms
};
```

### SSE events on `/api/queue/stream`

Each event has `event:` name and JSON `data:`.

| Event | Data | Meaning |
|---|---|---|
| `queue.updated` | `{entries, current}` | Queue or any entry's status changed |
| `settings.updated` | `{queue_mode, stage_immersive}` | Settings changed |
| `stage.claimed` | `{session: StageSession}` | Stage tab claimed |
| `stage.released` | `{}` | Stage tab released |
| `stage.evicted` | `{tab_id}` | Stage tab forcibly bumped (target tab should self-close) |
| `veto.pending` | `{veto: PendingVeto}` | Singer requested restart/skip; stage should prompt |
| `veto.approved` | `{veto_id, action, entry_id}` | Stage allowed (or timed out); apply action |
| `veto.denied` | `{veto_id}` | Stage rejected; singer's UI should show toast |
| `bot_challenge` | `{detected_at}` | yt-dlp blocked; admin needs cookies |
| `cache.full` | `{used_bytes, cap_bytes}` | Cache at cap, downloads paused |

### Authorization tiers

- **none** — no auth required.
- **session** — caller has a singer cookie OR an OIDC session. Anonymous browsers without registration can read but not mutate.
- **singer** — caller's resolved singer is non-null. Some routes additionally check ownership (e.g., singer must match the entry's singer).
- **stage** — caller's stage `tab_id` cookie matches the active `stage_session` row.

## Testing strategy

- **Pure logic** (vitest, no mocks) — `queue.ts` (FIFO + round-robin projection), `search-query.ts` (karaoke append/dedup), `veto.ts` (state machine with fake timers), `cache.ts` (eviction order on a tmpdir).
- **yt-dlp wrapper** — interface mocked in unit tests. One opt-in integration test that actually shells out, gated behind `RUN_NETWORK=1`.
- **API routes** — Next.js test handlers backed by an in-memory SQLite. Every endpoint in the contract table above gets coverage for: happy path, auth-tier rejection, validation errors. Veto flow gets dedicated tests for allow / deny / timeout.
- **SSE** — test the bus (`sse.ts`) directly with mock writers; don't try to test the route handler's stream lifecycle.
- **API-level integration** — programmatic test that drives the full flow against the running server (no browser): register guest → enqueue → wait for `ready` → simulate stage claim → trigger play → singer requests restart → stage allows → assert state transitions and SSE events. Gated behind `RUN_INTEGRATION=1`.
- **No browser/E2E tests in this spec** — those land with the UI work.

## Open questions

None blocking. Items deferred to implementation:

- Cache eviction trigger (post-play vs cron) — likely post-play with a startup sweep.
- Whether to expose veto-window length as a setting or keep it hardcoded at 5s.

UI-layer questions (intro splash duration, settings toggle confirm UX, sidebar layout, etc.) are out of scope here — they belong to the future UI spec.
