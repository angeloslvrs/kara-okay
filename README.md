# Karaoke

A self-hosted karaoke platform for parties and offices. Anyone in the room — signed in or not — searches YouTube for karaoke videos, queues them under their name, and sings. One designated browser tab plays video on the TV/projector.

Sibling project of [deejay](https://github.com/angeloslvrs/deejay); same self-hosted spirit, different problem.

## How it works

The **stage tab** runs on the device wired to the TV/projector. It plays video, holds operator controls (skip/restart/pause), and shows a veto prompt when the current singer wants to bail or restart. Everyone else uses their **phone tab** to register a name, search and queue videos, and request actions on their own song. Members and guests have identical permissions — sign-in is just for persistent identity across sessions.

Karaoke videos are pulled from YouTube via [yt-dlp](https://github.com/yt-dlp/yt-dlp) and pre-downloaded to local cache, so playback is instant and resilient to mid-song network blips. State syncs in real time over Server-Sent Events.

## Features

- Search across YouTube biased toward karaoke versions (channels like Sing King, KaraFun, Karaoke Version)
- Two queue modes — **FIFO** (classic queue) or **round-robin** (interleaved by singer; one mic, fair share)
- Singer veto flow — current performer can request restart/skip; stage operator confirms within 5s (auto-approves on silence)
- Pre-downloaded video cache with LRU eviction; streams from local disk with Range support
- Real-time queue sync via Server-Sent Events
- Stage tab claim model — one stage at a time, force-claim with eviction
- Lightweight singer registration; members auto-tagged via OIDC, guests claim a cookie-stored name
- Persistent state in SQLite

## Stack

- [Next.js](https://nextjs.org) 15 (App Router)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com) v4
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — embedded database, no external server required
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — YouTube video extraction
- [vitest](https://vitest.dev) — unit + API test runner

## Prerequisites

- Node.js 20+
- `yt-dlp` and `ffmpeg` on `PATH` (`brew install yt-dlp ffmpeg`)
- Optional: an OIDC provider (e.g. Google Workspace, Auth0) for member identity

## Getting started

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` (all values optional unless noted):

```env
# yt-dlp
YTDLP_BIN=yt-dlp
YTDLP_COOKIES_FILE=
CACHE_DIR=./data/cache
CACHE_MAX_BYTES=5368709120

# OIDC (omit to disable sign-in; everyone is a guest)
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=

# App
SESSION_SECRET=
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

```bash
npm run dev
```

Open `http://localhost:3000` on a phone (register a name, search, queue) and `http://localhost:3000/stage` on the device driving the TV (claim, play, run the show).

> **Note:** The pages at `/` and `/stage` are minimal debug scaffolds. They exercise every API endpoint but aren't intended as the production UI — that lives in a separate workstream.

## Running in production

```bash
npm run build
NODE_ENV=production npm start
```

Behind a reverse proxy, disable response buffering for `/api/queue/stream` so SSE works correctly.

Caddy:

```
karaoke.example.com {
  reverse_proxy localhost:3000 {
    flush_interval -1
  }
}
```

Nginx:

```nginx
location /api/queue/stream {
  proxy_pass         http://localhost:3000;
  proxy_http_version 1.1;
  proxy_buffering    off;
  proxy_cache        off;
}
```

## YouTube bot challenges

If yt-dlp is challenged with a "sign in to confirm you're not a bot" prompt, export your browser cookies to a Netscape-format file (e.g. via the "Get cookies.txt LOCALLY" Chrome extension while signed into youtube.com) and set:

```env
YTDLP_COOKIES_FILE=/absolute/path/to/cookies.txt
```

A free YouTube account is sufficient. Already-cached videos keep playing while you sort cookies out.

## API

This repository ships a fully documented backend API; the production UI is a separate project. The API contract (routes, payload shapes, SSE event names, auth tiers) is in [`docs/superpowers/specs/2026-05-05-karaoke-platform-design.md`](docs/superpowers/specs/2026-05-05-karaoke-platform-design.md).

## Running tests

```bash
npm test                            # unit + API (104 tests)
RUN_INTEGRATION=1 npm test          # adds the full-flow integration test
```

## License

MIT
