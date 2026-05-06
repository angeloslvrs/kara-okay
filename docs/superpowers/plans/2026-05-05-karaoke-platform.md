# Karaoke Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend, library, and API surface for a self-hosted karaoke platform — singers register, queue YouTube karaoke videos via yt-dlp, and a single "stage" tab plays cached video. UI is out of scope; this plan delivers an API contract for a separate UI agent to consume.

**Architecture:** Single Next.js 15 (App Router) app. SQLite (`better-sqlite3`) for state. Pure-logic library modules (queue projection, veto state machine, search-query normalization, cache eviction) tested in isolation with vitest. yt-dlp subprocess wrappers behind interfaces. Server-Sent Events for realtime sync. HTML5 `<video>` with Range-served local files (with streamed-URL fallback) for playback.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind v4 (configured but unused), better-sqlite3, vitest, yt-dlp (system binary), `jose` (OIDC), `cookie` (session cookies), Node.js 20+.

**Spec:** `docs/superpowers/specs/2026-05-05-karaoke-platform-design.md`

**Important — read before any Next.js code:** This is Next.js 15 with breaking changes. Skim `node_modules/next/dist/docs/` for App Router specifics (especially route handlers, dynamic params, cookies API) before writing route code. Heed deprecation notices.

---

## File structure

```
karaoke/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── vitest.config.ts
├── .env.example
├── .gitignore
├── data/                              # gitignored runtime state
│   ├── karaoke.db                     # SQLite
│   └── cache/                         # downloaded mp4s
├── docs/
│   └── superpowers/
│       ├── specs/2026-05-05-karaoke-platform-design.md
│       └── plans/2026-05-05-karaoke-platform.md
├── public/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # minimal root layout
│   │   ├── page.tsx                   # SCAFFOLD debug UI for phone API
│   │   ├── stage/page.tsx             # SCAFFOLD debug UI for stage API
│   │   ├── globals.css
│   │   └── api/
│   │       ├── search/route.ts
│   │       ├── queue/
│   │       │   ├── route.ts
│   │       │   ├── [id]/route.ts
│   │       │   └── stream/route.ts
│   │       ├── singer/
│   │       │   ├── route.ts
│   │       │   ├── me/route.ts
│   │       │   └── action/route.ts
│   │       ├── stage/
│   │       │   ├── claim/route.ts
│   │       │   ├── release/route.ts
│   │       │   ├── heartbeat/route.ts
│   │       │   └── action/route.ts
│   │       ├── veto/[id]/route.ts
│   │       ├── settings/route.ts
│   │       └── cache/[id]/route.ts
│   └── lib/
│       ├── db.ts                       # better-sqlite3 singleton + migrations
│       ├── ids.ts                      # uuid helpers
│       ├── search-query.ts             # pure: normalize karaoke append
│       ├── veto.ts                     # in-memory state machine + 5s timer
│       ├── sse.ts                      # broadcast bus
│       ├── cache.ts                    # eviction (LRU + cap)
│       ├── singers.ts                  # CRUD on singers table
│       ├── settings.ts                 # CRUD on settings (typed)
│       ├── queue.ts                    # enqueue, advance, FIFO + RR projection
│       ├── stage.ts                    # claim, release, heartbeat
│       ├── auth/
│       │   ├── session.ts              # cookie session (singer-cookie + tab_id)
│       │   └── oidc.ts                 # optional OIDC flow
│       ├── ytdlp/
│       │   ├── types.ts                # interfaces for fakability
│       │   ├── search.ts               # ytsearch10 wrapper
│       │   ├── resolve.ts              # yt-dlp -g
│       │   ├── download.ts             # download to file
│       │   └── detect.ts               # bot-challenge stderr detection
│       └── worker/
│           └── download-worker.ts      # poller that drains queued -> downloading -> ready
└── tests/
    ├── unit/
    │   ├── search-query.test.ts
    │   ├── veto.test.ts
    │   ├── sse.test.ts
    │   ├── cache.test.ts
    │   ├── queue-fifo.test.ts
    │   ├── queue-roundrobin.test.ts
    │   ├── singers.test.ts
    │   ├── settings.test.ts
    │   ├── stage.test.ts
    │   └── ytdlp-detect.test.ts
    ├── api/
    │   ├── search.test.ts
    │   ├── queue.test.ts
    │   ├── singer.test.ts
    │   ├── stage.test.ts
    │   ├── veto.test.ts
    │   ├── settings.test.ts
    │   └── cache.test.ts
    ├── integration/
    │   └── full-flow.test.ts           # gated behind RUN_INTEGRATION=1
    └── helpers/
        ├── test-db.ts                  # fresh in-memory DB per test
        └── fake-ytdlp.ts               # in-memory fake of ytdlp interface
```

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "karaoke",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "better-sqlite3": "^11.0.0",
    "jose": "^5.0.0",
    "cookie": "^1.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@types/cookie": "^1.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "postcss": "^8.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
```

- [ ] **Step 4: Create `postcss.config.mjs`**

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

- [ ] **Step 5: Create `eslint.config.mjs`**

```js
import next from 'eslint-config-next';
export default [...next];
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
.next/
out/
data/
.env*.local
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 8: Create `.env.example`**

```env
# yt-dlp
YTDLP_BIN=yt-dlp
YTDLP_COOKIES_FILE=
CACHE_DIR=./data/cache
CACHE_MAX_BYTES=5368709120

# OIDC (all optional)
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=

# App
SESSION_SECRET=
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

- [ ] **Step 9: Create `src/app/globals.css`**

```css
@import 'tailwindcss';
```

- [ ] **Step 10: Create `src/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Karaoke' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 11: Install and verify**

Run: `npm install`
Run: `npx tsc --noEmit`
Expected: no output (clean compile).

- [ ] **Step 12: Commit**

```bash
git init
git add .
git commit -m "chore: bootstrap Next.js 15 + vitest + better-sqlite3 project"
```

---

## Task 2: Database singleton and schema

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/ids.ts`
- Create: `tests/helpers/test-db.ts`
- Test: implicit (used by every other test)

- [ ] **Step 1: Create `src/lib/ids.ts`**

```ts
import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomUUID().replace(/-/g, '');
}
```

- [ ] **Step 2: Create `src/lib/db.ts`**

```ts
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS singers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  oidc_sub TEXT UNIQUE,
  cookie_token TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_sang_at INTEGER
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  singer_id TEXT NOT NULL REFERENCES singers(id),
  youtube_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT,
  duration_sec INTEGER,
  thumbnail_url TEXT,
  status TEXT NOT NULL,
  cache_path TEXT,
  fail_reason TEXT,
  enqueued_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_session (
  tab_id TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_entries(status);
CREATE INDEX IF NOT EXISTS idx_queue_position ON queue_entries(position);
CREATE INDEX IF NOT EXISTS idx_singers_cookie ON singers(cookie_token);
CREATE INDEX IF NOT EXISTS idx_singers_oidc ON singers(oidc_sub);
`;

const DEFAULT_SETTINGS: Record<string, string> = {
  queue_mode: 'fifo',
  stage_immersive: '0',
  cache_max_bytes: String(5 * 1024 * 1024 * 1024),
};

export function migrate(db: DB): void {
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);
}

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const file = process.env.KARAOKE_DB ?? path.resolve('./data/karaoke.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  _db = new Database(file);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

export function openMemoryDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function setDbForTest(db: DB): void {
  _db = db;
}
```

- [ ] **Step 3: Create `tests/helpers/test-db.ts`**

```ts
import type { DB } from '@/lib/db';
import { openMemoryDb, setDbForTest } from '@/lib/db';

export function freshDb(): DB {
  const db = openMemoryDb();
  setDbForTest(db);
  return db;
}
```

- [ ] **Step 4: Smoke test the schema**

Create `tests/unit/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';

describe('db migration', () => {
  it('creates all tables and seeds settings', () => {
    const db = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map((t: any) => t.name);
    expect(names).toContain('singers');
    expect(names).toContain('queue_entries');
    expect(names).toContain('settings');
    expect(names).toContain('stage_session');

    const mode = db.prepare("SELECT value FROM settings WHERE key='queue_mode'").get() as any;
    expect(mode.value).toBe('fifo');
  });
});
```

- [ ] **Step 5: Run test**

Run: `npm test -- tests/unit/db.test.ts`
Expected: 1 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/ids.ts tests/helpers/test-db.ts tests/unit/db.test.ts
git commit -m "feat(db): better-sqlite3 singleton with migrations and seed settings"
```

---

## Task 3: search-query normalization (TDD, pure)

**Files:**
- Create: `src/lib/search-query.ts`
- Test: `tests/unit/search-query.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/search-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeQuery } from '@/lib/search-query';

describe('normalizeQuery', () => {
  it('appends "karaoke" when missing', () => {
    expect(normalizeQuery('Bohemian Rhapsody')).toBe('Bohemian Rhapsody karaoke');
  });

  it('does not append when already present (lowercase)', () => {
    expect(normalizeQuery('bohemian rhapsody karaoke')).toBe('bohemian rhapsody karaoke');
  });

  it('does not append when already present (uppercase)', () => {
    expect(normalizeQuery('Bohemian Rhapsody KARAOKE')).toBe('Bohemian Rhapsody KARAOKE');
  });

  it('does not append when "Karaoke" appears mid-string', () => {
    expect(normalizeQuery('Karaoke Version of Wonderwall')).toBe('Karaoke Version of Wonderwall');
  });

  it('does not match substrings ("karaokey" should still get karaoke appended)', () => {
    expect(normalizeQuery('karaokey')).toBe('karaokey karaoke');
  });

  it('trims whitespace', () => {
    expect(normalizeQuery('  hello world  ')).toBe('hello world karaoke');
  });

  it('handles empty string', () => {
    expect(normalizeQuery('')).toBe('karaoke');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/search-query.test.ts`
Expected: failures, "Cannot find module '@/lib/search-query'".

- [ ] **Step 3: Implement**

Create `src/lib/search-query.ts`:

```ts
const KARAOKE_RE = /\bkaraoke\b/i;

export function normalizeQuery(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return 'karaoke';
  if (KARAOKE_RE.test(trimmed)) return trimmed;
  return `${trimmed} karaoke`;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/search-query.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/search-query.ts tests/unit/search-query.test.ts
git commit -m "feat(search): query normalization appends 'karaoke' with whole-word dedup"
```

---

## Task 4: Veto state machine (TDD, pure with fake timers)

**Files:**
- Create: `src/lib/veto.ts`
- Test: `tests/unit/veto.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/veto.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VetoStore, VETO_WINDOW_MS } from '@/lib/veto';

describe('VetoStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens a veto and emits pending', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    expect(v.action).toBe('restart');
    expect(events).toEqual([{ kind: 'pending', veto: v }]);
  });

  it('approves on explicit allow', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    const result = store.decide(v.id, 'allow');
    expect(result).toBe('approved');
    expect(events.at(-1)).toEqual({ kind: 'approved', veto_id: v.id, action: 'restart', entry_id: 'e1' });
  });

  it('denies on explicit deny', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'skip', entry_id: 'e1', singer_id: 's1' });
    const result = store.decide(v.id, 'deny');
    expect(result).toBe('denied');
    expect(events.at(-1)).toEqual({ kind: 'denied', veto_id: v.id });
  });

  it('auto-approves after window', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    expect(events.at(-1)).toEqual({ kind: 'approved', veto_id: v.id, action: 'restart', entry_id: 'e1' });
  });

  it('returns "unknown" on decide for missing id', () => {
    const store = new VetoStore(() => {});
    expect(store.decide('nope', 'allow')).toBe('unknown');
  });

  it('does not double-resolve', () => {
    const events: any[] = [];
    const store = new VetoStore((e) => events.push(e));
    const v = store.open({ action: 'restart', entry_id: 'e1', singer_id: 's1' });
    store.decide(v.id, 'allow');
    expect(store.decide(v.id, 'deny')).toBe('unknown');
    vi.advanceTimersByTime(VETO_WINDOW_MS + 10);
    const approveCount = events.filter((e) => e.kind === 'approved').length;
    expect(approveCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/veto.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/veto.ts`:

```ts
import { newId } from './ids';

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

type Entry = { veto: PendingVeto; timer: NodeJS.Timeout };

export class VetoStore {
  private map = new Map<string, Entry>();
  constructor(private emit: (e: VetoEvent) => void) {}

  open(input: { action: VetoAction; entry_id: string; singer_id: string }): PendingVeto {
    const id = newId();
    const veto: PendingVeto = {
      id,
      action: input.action,
      entry_id: input.entry_id,
      singer_id: input.singer_id,
      expires_at: Date.now() + VETO_WINDOW_MS,
    };
    const timer = setTimeout(() => this.resolveApprove(id), VETO_WINDOW_MS);
    this.map.set(id, { veto, timer });
    this.emit({ kind: 'pending', veto });
    return veto;
  }

  decide(id: string, decision: Decision): DecideResult {
    const e = this.map.get(id);
    if (!e) return 'unknown';
    clearTimeout(e.timer);
    this.map.delete(id);
    if (decision === 'allow') {
      this.emit({ kind: 'approved', veto_id: id, action: e.veto.action, entry_id: e.veto.entry_id });
      return 'approved';
    }
    this.emit({ kind: 'denied', veto_id: id });
    return 'denied';
  }

  list(): PendingVeto[] {
    return Array.from(this.map.values()).map((e) => e.veto);
  }

  private resolveApprove(id: string) {
    const e = this.map.get(id);
    if (!e) return;
    this.map.delete(id);
    this.emit({ kind: 'approved', veto_id: id, action: e.veto.action, entry_id: e.veto.entry_id });
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/veto.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/veto.ts tests/unit/veto.test.ts
git commit -m "feat(veto): in-memory state machine with 5s auto-approve window"
```

---

## Task 5: SSE bus (TDD with fake writers)

**Files:**
- Create: `src/lib/sse.ts`
- Test: `tests/unit/sse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/sse.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SseBus } from '@/lib/sse';

describe('SseBus', () => {
  it('broadcasts an event to all subscribers', () => {
    const bus = new SseBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    bus.broadcast('queue.updated', { foo: 1 });
    expect(a).toHaveBeenCalledWith('queue.updated', { foo: 1 });
    expect(b).toHaveBeenCalledWith('queue.updated', { foo: 1 });
  });

  it('returns an unsubscribe function', () => {
    const bus = new SseBus();
    const a = vi.fn();
    const off = bus.subscribe(a);
    off();
    bus.broadcast('test', {});
    expect(a).not.toHaveBeenCalled();
  });

  it('formats SSE wire output', () => {
    expect(SseBus.format('queue.updated', { x: 1 })).toBe(
      'event: queue.updated\ndata: {"x":1}\n\n',
    );
  });

  it('isolates subscriber errors', () => {
    const bus = new SseBus();
    bus.subscribe(() => { throw new Error('boom'); });
    const ok = vi.fn();
    bus.subscribe(ok);
    expect(() => bus.broadcast('e', {})).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/sse.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/sse.ts`:

```ts
export type SseListener = (event: string, data: unknown) => void;

export class SseBus {
  private listeners = new Set<SseListener>();

  subscribe(fn: SseListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  broadcast(event: string, data: unknown): void {
    for (const fn of this.listeners) {
      try { fn(event, data); } catch { /* isolate */ }
    }
  }

  static format(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

let _bus: SseBus | null = null;
export function getBus(): SseBus {
  if (!_bus) _bus = new SseBus();
  return _bus;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/sse.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sse.ts tests/unit/sse.test.ts
git commit -m "feat(sse): in-process broadcast bus with subscriber isolation"
```

---

## Task 6: Cache module (TDD, file-based)

**Files:**
- Create: `src/lib/cache.ts`
- Test: `tests/unit/cache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CacheManager } from '@/lib/cache';

describe('CacheManager', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function write(name: string, bytes: number) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, Buffer.alloc(bytes));
    return p;
  }

  it('reports size of dir', () => {
    write('a.mp4', 1000);
    write('b.mp4', 2000);
    const c = new CacheManager(dir, 10_000);
    expect(c.usedBytes()).toBe(3000);
  });

  it('evicts files older than keep set when over cap', () => {
    const a = write('a.mp4', 1000);
    const b = write('b.mp4', 1000);
    const cFile = write('c.mp4', 1000);
    fs.utimesSync(a, new Date(1000), new Date(1000));
    fs.utimesSync(b, new Date(2000), new Date(2000));
    fs.utimesSync(cFile, new Date(3000), new Date(3000));
    const c = new CacheManager(dir, 1500);
    c.evict(new Set([cFile])); // keep c (currently playing)
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
    expect(fs.existsSync(cFile)).toBe(true);
  });

  it('keeps everything in the keep set even if over cap', () => {
    const a = write('a.mp4', 1000);
    const b = write('b.mp4', 1000);
    const c = new CacheManager(dir, 500);
    c.evict(new Set([a, b]));
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
  });

  it('returns absolute path for a youtube id', () => {
    const c = new CacheManager(dir, 1000);
    expect(c.pathFor('abc123')).toBe(path.join(dir, 'abc123.mp4'));
  });

  it('hasFile is true after touch', () => {
    const c = new CacheManager(dir, 1000);
    write('xyz.mp4', 100);
    expect(c.hasFile('xyz')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/cache.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/cache.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

export class CacheManager {
  constructor(private readonly dir: string, private readonly capBytes: number) {
    fs.mkdirSync(dir, { recursive: true });
  }

  pathFor(youtubeId: string): string {
    return path.join(this.dir, `${youtubeId}.mp4`);
  }

  hasFile(youtubeId: string): boolean {
    return fs.existsSync(this.pathFor(youtubeId));
  }

  usedBytes(): number {
    let total = 0;
    for (const name of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, name);
      const st = fs.statSync(p);
      if (st.isFile()) total += st.size;
    }
    return total;
  }

  evict(keep: Set<string>): void {
    if (this.usedBytes() <= this.capBytes) return;
    const files = fs.readdirSync(this.dir)
      .map((n) => path.join(this.dir, n))
      .filter((p) => fs.statSync(p).isFile() && !keep.has(p))
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    for (const f of files) {
      if (this.usedBytes() <= this.capBytes) break;
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/cache.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts tests/unit/cache.test.ts
git commit -m "feat(cache): LRU eviction with keep-set protection"
```

---

## Task 7: Singers module (TDD)

**Files:**
- Create: `src/lib/singers.ts`
- Test: `tests/unit/singers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/singers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest, findByCookie, upsertMember, findById, updateLastSang } from '@/lib/singers';

describe('singers', () => {
  it('registers a guest with a cookie token', () => {
    const db = freshDb();
    const { singer, cookie_token } = registerGuest(db, 'Angelo');
    expect(singer.display_name).toBe('Angelo');
    expect(singer.is_member).toBe(false);
    expect(cookie_token).toBeTruthy();
  });

  it('finds guest by cookie', () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'Angelo');
    const found = findByCookie(db, cookie_token);
    expect(found?.display_name).toBe('Angelo');
  });

  it('returns null for unknown cookie', () => {
    const db = freshDb();
    expect(findByCookie(db, 'nope')).toBeNull();
  });

  it('upserts a member by oidc_sub', () => {
    const db = freshDb();
    const a = upsertMember(db, 'sub-1', 'Angelo S.');
    const b = upsertMember(db, 'sub-1', 'Angelo Soliveres');
    expect(a.id).toBe(b.id);
    expect(b.display_name).toBe('Angelo Soliveres');
    expect(b.is_member).toBe(true);
  });

  it('updates last_sang_at', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'Angelo');
    updateLastSang(db, singer.id, 1234);
    const row = db.prepare('SELECT last_sang_at FROM singers WHERE id=?').get(singer.id) as any;
    expect(row.last_sang_at).toBe(1234);
  });

  it('rejects empty display name', () => {
    const db = freshDb();
    expect(() => registerGuest(db, '')).toThrow();
    expect(() => registerGuest(db, '   ')).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/singers.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/singers.ts`:

```ts
import type { DB } from './db';
import { newId, newToken } from './ids';

export type Singer = {
  id: string;
  display_name: string;
  is_member: boolean;
};

type Row = {
  id: string;
  display_name: string;
  oidc_sub: string | null;
  cookie_token: string | null;
  created_at: number;
  last_sang_at: number | null;
};

function rowToSinger(r: Row): Singer {
  return { id: r.id, display_name: r.display_name, is_member: r.oidc_sub !== null };
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('display_name is required');
  return trimmed;
}

export function registerGuest(db: DB, displayName: string): { singer: Singer; cookie_token: string } {
  const name = validateName(displayName);
  const id = newId();
  const token = newToken();
  db.prepare(
    'INSERT INTO singers (id, display_name, cookie_token, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, name, token, Date.now());
  const row = db.prepare('SELECT * FROM singers WHERE id=?').get(id) as Row;
  return { singer: rowToSinger(row), cookie_token: token };
}

export function findByCookie(db: DB, token: string): Singer | null {
  const row = db.prepare('SELECT * FROM singers WHERE cookie_token=?').get(token) as Row | undefined;
  return row ? rowToSinger(row) : null;
}

export function findById(db: DB, id: string): Singer | null {
  const row = db.prepare('SELECT * FROM singers WHERE id=?').get(id) as Row | undefined;
  return row ? rowToSinger(row) : null;
}

export function upsertMember(db: DB, oidcSub: string, displayName: string): Singer {
  const name = validateName(displayName);
  const existing = db.prepare('SELECT * FROM singers WHERE oidc_sub=?').get(oidcSub) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE singers SET display_name=? WHERE id=?').run(name, existing.id);
    return { id: existing.id, display_name: name, is_member: true };
  }
  const id = newId();
  db.prepare(
    'INSERT INTO singers (id, display_name, oidc_sub, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, name, oidcSub, Date.now());
  return { id, display_name: name, is_member: true };
}

export function updateLastSang(db: DB, singerId: string, timestamp: number): void {
  db.prepare('UPDATE singers SET last_sang_at=? WHERE id=?').run(timestamp, singerId);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/singers.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/singers.ts tests/unit/singers.test.ts
git commit -m "feat(singers): guest registration and member upsert"
```

---

## Task 8: Settings module (TDD)

**Files:**
- Create: `src/lib/settings.ts`
- Test: `tests/unit/settings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { getSettings, updateSettings } from '@/lib/settings';

describe('settings', () => {
  it('returns defaults', () => {
    const db = freshDb();
    const s = getSettings(db);
    expect(s.queue_mode).toBe('fifo');
    expect(s.stage_immersive).toBe(false);
    expect(s.cache_max_bytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it('updates queue_mode', () => {
    const db = freshDb();
    updateSettings(db, { queue_mode: 'round_robin' });
    expect(getSettings(db).queue_mode).toBe('round_robin');
  });

  it('updates stage_immersive', () => {
    const db = freshDb();
    updateSettings(db, { stage_immersive: true });
    expect(getSettings(db).stage_immersive).toBe(true);
  });

  it('rejects invalid queue_mode', () => {
    const db = freshDb();
    expect(() => updateSettings(db, { queue_mode: 'bogus' as any })).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/settings.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/settings.ts`:

```ts
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
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/settings.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts tests/unit/settings.test.ts
git commit -m "feat(settings): typed get/update with validation"
```

---

## Task 9: Queue module — enqueue, advance, FIFO (TDD)

**Files:**
- Create: `src/lib/queue.ts`
- Test: `tests/unit/queue-fifo.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/queue-fifo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest } from '@/lib/singers';
import { enqueue, getActiveQueue, getCurrent, markStatus, removeEntry } from '@/lib/queue';

describe('queue (fifo)', () => {
  it('enqueues an entry with status=queued', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, {
      youtube_id: 'yt1', title: 'Song A', channel: null, duration_sec: 180, thumbnail_url: null,
    });
    expect(e.status).toBe('queued');
    expect(e.title).toBe('Song A');
  });

  it('orders queue by enqueue position (FIFO)', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    enqueue(db, a.id, { youtube_id: 'yt1', title: 'A1', channel: null, duration_sec: null, thumbnail_url: null });
    enqueue(db, b.id, { youtube_id: 'yt2', title: 'B1', channel: null, duration_sec: null, thumbnail_url: null });
    enqueue(db, a.id, { youtube_id: 'yt3', title: 'A2', channel: null, duration_sec: null, thumbnail_url: null });
    const q = getActiveQueue(db, 'fifo');
    expect(q.map((e) => e.title)).toEqual(['A1', 'B1', 'A2']);
  });

  it('excludes played/skipped/failed from active queue', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e1 = enqueue(db, singer.id, { youtube_id: 'yt1', title: 'P', channel: null, duration_sec: null, thumbnail_url: null });
    enqueue(db, singer.id, { youtube_id: 'yt2', title: 'Q', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e1.id, 'played');
    const q = getActiveQueue(db, 'fifo');
    expect(q.map((e) => e.title)).toEqual(['Q']);
  });

  it('getCurrent returns the playing entry', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    expect(getCurrent(db)?.id).toBe(e.id);
  });

  it('removes a queued entry', () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    expect(removeEntry(db, e.id)).toBe(true);
    expect(getActiveQueue(db, 'fifo')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/queue-fifo.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/queue.ts`:

```ts
import type { DB } from './db';
import { newId } from './ids';
import { findById as findSinger } from './singers';
import type { Singer } from './singers';
import type { QueueMode } from './settings';

export type EntryStatus = 'queued' | 'downloading' | 'ready' | 'playing' | 'played' | 'skipped' | 'failed';

export type QueueEntry = {
  id: string;
  singer: Singer;
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
  status: EntryStatus;
  fail_reason: string | null;
  enqueued_at: number;
  started_at: number | null;
  ended_at: number | null;
};

type Row = {
  id: string;
  singer_id: string;
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
  status: EntryStatus;
  cache_path: string | null;
  fail_reason: string | null;
  enqueued_at: number;
  started_at: number | null;
  ended_at: number | null;
  position: number;
};

const ACTIVE_STATUSES = ['queued', 'downloading', 'ready'] as const;

function rowToEntry(db: DB, r: Row): QueueEntry {
  const singer = findSinger(db, r.singer_id);
  if (!singer) throw new Error(`singer ${r.singer_id} missing for entry ${r.id}`);
  return {
    id: r.id,
    singer,
    youtube_id: r.youtube_id,
    title: r.title,
    channel: r.channel,
    duration_sec: r.duration_sec,
    thumbnail_url: r.thumbnail_url,
    status: r.status,
    fail_reason: r.fail_reason,
    enqueued_at: r.enqueued_at,
    started_at: r.started_at,
    ended_at: r.ended_at,
  };
}

export type EnqueueInput = {
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
};

export function enqueue(db: DB, singerId: string, input: EnqueueInput): QueueEntry {
  const id = newId();
  const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM queue_entries').get() as any).m;
  db.prepare(
    `INSERT INTO queue_entries
     (id, singer_id, youtube_id, title, channel, duration_sec, thumbnail_url, status, enqueued_at, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(id, singerId, input.youtube_id, input.title, input.channel, input.duration_sec, input.thumbnail_url, Date.now(), maxPos + 1);
  const row = db.prepare('SELECT * FROM queue_entries WHERE id=?').get(id) as Row;
  return rowToEntry(db, row);
}

export function markStatus(db: DB, entryId: string, status: EntryStatus, extra: Partial<Row> = {}): QueueEntry | null {
  const sets: string[] = ['status=?'];
  const vals: any[] = [status];
  if (extra.cache_path !== undefined) { sets.push('cache_path=?'); vals.push(extra.cache_path); }
  if (extra.fail_reason !== undefined) { sets.push('fail_reason=?'); vals.push(extra.fail_reason); }
  if (status === 'playing') { sets.push('started_at=?'); vals.push(Date.now()); }
  if (status === 'played' || status === 'skipped' || status === 'failed') { sets.push('ended_at=?'); vals.push(Date.now()); }
  vals.push(entryId);
  db.prepare(`UPDATE queue_entries SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  const row = db.prepare('SELECT * FROM queue_entries WHERE id=?').get(entryId) as Row | undefined;
  return row ? rowToEntry(db, row) : null;
}

export function findEntry(db: DB, entryId: string): QueueEntry | null {
  const row = db.prepare('SELECT * FROM queue_entries WHERE id=?').get(entryId) as Row | undefined;
  return row ? rowToEntry(db, row) : null;
}

export function entryCachePath(db: DB, entryId: string): string | null {
  const r = db.prepare('SELECT cache_path FROM queue_entries WHERE id=?').get(entryId) as { cache_path: string | null } | undefined;
  return r?.cache_path ?? null;
}

export function getCurrent(db: DB): QueueEntry | null {
  const row = db.prepare(`SELECT * FROM queue_entries WHERE status='playing' ORDER BY started_at DESC LIMIT 1`).get() as Row | undefined;
  return row ? rowToEntry(db, row) : null;
}

export function removeEntry(db: DB, entryId: string): boolean {
  const r = db.prepare(`DELETE FROM queue_entries WHERE id=? AND status IN ('queued','downloading','ready')`).run(entryId);
  return r.changes > 0;
}

export function getActiveQueue(db: DB, mode: QueueMode): QueueEntry[] {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM queue_entries WHERE status IN (${placeholders}) ORDER BY position ASC`).all(...ACTIVE_STATUSES) as Row[];
  if (mode === 'fifo') return rows.map((r) => rowToEntry(db, r));
  return projectRoundRobin(db, rows);
}

function projectRoundRobin(db: DB, rows: Row[]): QueueEntry[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.singer_id) ?? [];
    list.push(r);
    groups.set(r.singer_id, list);
  }
  const singerOrder = Array.from(groups.keys()).sort((a, b) => {
    const ra = db.prepare('SELECT last_sang_at FROM singers WHERE id=?').get(a) as { last_sang_at: number | null };
    const rb = db.prepare('SELECT last_sang_at FROM singers WHERE id=?').get(b) as { last_sang_at: number | null };
    const av = ra.last_sang_at ?? -1;
    const bv = rb.last_sang_at ?? -1;
    return av - bv;
  });
  const out: QueueEntry[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const sid of singerOrder) {
      const list = groups.get(sid)!;
      const next = list.shift();
      if (next) {
        out.push(rowToEntry(db, next));
        progress = true;
      }
    }
  }
  return out;
}

export function listPendingDownloads(db: DB): QueueEntry[] {
  const rows = db.prepare(`SELECT * FROM queue_entries WHERE status='queued' ORDER BY position ASC`).all() as Row[];
  return rows.map((r) => rowToEntry(db, r));
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/queue-fifo.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue.ts tests/unit/queue-fifo.test.ts
git commit -m "feat(queue): enqueue, status transitions, FIFO projection"
```

---

## Task 10: Round-robin projection (TDD)

**Files:**
- Modify: (queue.ts already implements this — add tests)
- Test: `tests/unit/queue-roundrobin.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/queue-roundrobin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest, updateLastSang } from '@/lib/singers';
import { enqueue, getActiveQueue } from '@/lib/queue';

function add(db: any, sid: string, title: string) {
  return enqueue(db, sid, { youtube_id: title, title, channel: null, duration_sec: null, thumbnail_url: null });
}

describe('queue (round-robin)', () => {
  it('interleaves singers by last_sang_at (nulls first)', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    updateLastSang(db, a.id, 5000);
    add(db, a.id, 'A1');
    add(db, a.id, 'A2');
    add(db, b.id, 'B1');
    const q = getActiveQueue(db, 'round_robin');
    expect(q.map((e) => e.title)).toEqual(['B1', 'A1', 'A2']);
  });

  it('orders never-sung singers by registration order via last_sang_at=null', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    add(db, b.id, 'B1');
    add(db, a.id, 'A1');
    add(db, b.id, 'B2');
    add(db, a.id, 'A2');
    const q = getActiveQueue(db, 'round_robin');
    expect(q.map((e) => e.title)).toEqual(['B1', 'A1', 'B2', 'A2']);
  });

  it('falls through if a singer has nothing queued in this round', () => {
    const db = freshDb();
    const a = registerGuest(db, 'A').singer;
    const b = registerGuest(db, 'B').singer;
    add(db, a.id, 'A1');
    add(db, a.id, 'A2');
    add(db, a.id, 'A3');
    add(db, b.id, 'B1');
    const q = getActiveQueue(db, 'round_robin');
    expect(q.map((e) => e.title)).toEqual(['A1', 'B1', 'A2', 'A3']);
  });

  it('returns empty for no entries', () => {
    const db = freshDb();
    expect(getActiveQueue(db, 'round_robin')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- tests/unit/queue-roundrobin.test.ts`
Expected: 4 passing (queue.ts already supports round-robin).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/queue-roundrobin.test.ts
git commit -m "test(queue): cover round-robin projection edge cases"
```

---

## Task 11: Stage session module (TDD)

**Files:**
- Create: `src/lib/stage.ts`
- Test: `tests/unit/stage.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/stage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { claimStage, releaseStage, heartbeat, getActiveStage, STAGE_HEARTBEAT_TTL_MS } from '@/lib/stage';

describe('stage', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('claims when no active stage', () => {
    const db = freshDb();
    const r = claimStage(db, 'tab-1', false);
    expect(r.kind).toBe('claimed');
    expect(getActiveStage(db)?.tab_id).toBe('tab-1');
  });

  it('rejects second claim without force', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    const r = claimStage(db, 'tab-2', false);
    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') expect(r.current.tab_id).toBe('tab-1');
  });

  it('force-claim evicts existing', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    const r = claimStage(db, 'tab-2', true);
    expect(r.kind).toBe('claimed');
    if (r.kind === 'claimed') expect(r.evicted).toBe('tab-1');
    expect(getActiveStage(db)?.tab_id).toBe('tab-2');
  });

  it('claim succeeds if existing heartbeat is stale', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    vi.advanceTimersByTime(STAGE_HEARTBEAT_TTL_MS + 100);
    const r = claimStage(db, 'tab-2', false);
    expect(r.kind).toBe('claimed');
  });

  it('heartbeat updates last_heartbeat', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    vi.advanceTimersByTime(5000);
    heartbeat(db, 'tab-1');
    const s = getActiveStage(db);
    expect(s?.last_heartbeat).toBe(1_005_000);
  });

  it('heartbeat from unknown tab returns false', () => {
    const db = freshDb();
    expect(heartbeat(db, 'nope')).toBe(false);
  });

  it('release clears active stage', () => {
    const db = freshDb();
    claimStage(db, 'tab-1', false);
    expect(releaseStage(db, 'tab-1')).toBe(true);
    expect(getActiveStage(db)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/stage.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/stage.ts`:

```ts
import type { DB } from './db';

export const STAGE_HEARTBEAT_TTL_MS = 30_000;

export type StageSession = {
  tab_id: string;
  claimed_at: number;
  last_heartbeat: number;
};

export type ClaimResult =
  | { kind: 'claimed'; session: StageSession; evicted: string | null }
  | { kind: 'conflict'; current: StageSession };

export function getActiveStage(db: DB): StageSession | null {
  const row = db.prepare('SELECT * FROM stage_session LIMIT 1').get() as StageSession | undefined;
  if (!row) return null;
  if (Date.now() - row.last_heartbeat > STAGE_HEARTBEAT_TTL_MS) return null;
  return row;
}

export function claimStage(db: DB, tabId: string, force: boolean): ClaimResult {
  const current = getActiveStage(db);
  if (current && current.tab_id !== tabId && !force) {
    return { kind: 'conflict', current };
  }
  const evicted = current && current.tab_id !== tabId ? current.tab_id : null;
  db.prepare('DELETE FROM stage_session').run();
  const now = Date.now();
  db.prepare('INSERT INTO stage_session (tab_id, claimed_at, last_heartbeat) VALUES (?, ?, ?)').run(tabId, now, now);
  return { kind: 'claimed', session: { tab_id: tabId, claimed_at: now, last_heartbeat: now }, evicted };
}

export function heartbeat(db: DB, tabId: string): boolean {
  const r = db.prepare('UPDATE stage_session SET last_heartbeat=? WHERE tab_id=?').run(Date.now(), tabId);
  return r.changes > 0;
}

export function releaseStage(db: DB, tabId: string): boolean {
  const r = db.prepare('DELETE FROM stage_session WHERE tab_id=?').run(tabId);
  return r.changes > 0;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/unit/stage.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stage.ts tests/unit/stage.test.ts
git commit -m "feat(stage): claim, heartbeat, release with TTL eviction"
```

---

## Task 12: yt-dlp wrapper interfaces and bot detection (TDD)

**Files:**
- Create: `src/lib/ytdlp/types.ts`
- Create: `src/lib/ytdlp/detect.ts`
- Test: `tests/unit/ytdlp-detect.test.ts`
- Create: `tests/helpers/fake-ytdlp.ts`

- [ ] **Step 1: Create interface file**

Create `src/lib/ytdlp/types.ts`:

```ts
export type YtSearchResult = {
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
};

export interface YtDlp {
  search(query: string, limit?: number): Promise<YtSearchResult[]>;
  resolve(youtubeId: string): Promise<string>; // signed url
  download(youtubeId: string, destPath: string): Promise<void>;
}

export class BotChallengeError extends Error {
  constructor(message = 'YouTube bot challenge') { super(message); this.name = 'BotChallengeError'; }
}
```

- [ ] **Step 2: Write detection tests**

Create `tests/unit/ytdlp-detect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isBotChallenge } from '@/lib/ytdlp/detect';

describe('isBotChallenge', () => {
  it('matches "Sign in to confirm"', () => {
    expect(isBotChallenge('ERROR: [youtube] xyz: Sign in to confirm you’re not a bot')).toBe(true);
  });
  it('matches HTTP 429', () => {
    expect(isBotChallenge('ERROR: HTTP Error 429: Too Many Requests')).toBe(true);
  });
  it('matches "Video unavailable. This content isn\'t available"', () => {
    expect(isBotChallenge("ERROR: [youtube] xyz: Video unavailable. This content isn't available, try again later")).toBe(true);
  });
  it('does not match generic error', () => {
    expect(isBotChallenge('ERROR: ffmpeg not found')).toBe(false);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test -- tests/unit/ytdlp-detect.test.ts`
Expected: failures.

- [ ] **Step 4: Implement**

Create `src/lib/ytdlp/detect.ts`:

```ts
const PATTERNS = [
  /Sign in to confirm/i,
  /HTTP Error 429/i,
  /This content isn'?t available, try again later/i,
  /Please sign in/i,
];

export function isBotChallenge(stderr: string): boolean {
  return PATTERNS.some((p) => p.test(stderr));
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm test -- tests/unit/ytdlp-detect.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Create fake for later use**

Create `tests/helpers/fake-ytdlp.ts`:

```ts
import type { YtDlp, YtSearchResult } from '@/lib/ytdlp/types';
import fs from 'node:fs';

export class FakeYtDlp implements YtDlp {
  searchResults: YtSearchResult[] = [];
  resolveUrl: string | (() => Promise<string> | string) = 'https://example.com/video.mp4';
  downloadDelayMs = 0;
  downloadShouldFail = false;
  downloadCalls: Array<{ youtubeId: string; destPath: string }> = [];

  async search(): Promise<YtSearchResult[]> { return this.searchResults; }

  async resolve(): Promise<string> {
    return typeof this.resolveUrl === 'function' ? await this.resolveUrl() : this.resolveUrl;
  }

  async download(youtubeId: string, destPath: string): Promise<void> {
    this.downloadCalls.push({ youtubeId, destPath });
    if (this.downloadDelayMs) await new Promise((r) => setTimeout(r, this.downloadDelayMs));
    if (this.downloadShouldFail) throw new Error('fake download failure');
    fs.writeFileSync(destPath, Buffer.from('fake mp4'));
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/ytdlp/types.ts src/lib/ytdlp/detect.ts tests/unit/ytdlp-detect.test.ts tests/helpers/fake-ytdlp.ts
git commit -m "feat(ytdlp): interface, bot-challenge detection, test fake"
```

---

## Task 13: yt-dlp real implementations (search, resolve, download)

**Files:**
- Create: `src/lib/ytdlp/search.ts`
- Create: `src/lib/ytdlp/resolve.ts`
- Create: `src/lib/ytdlp/download.ts`
- Create: `src/lib/ytdlp/index.ts`

These shell out to yt-dlp; they're verified by an opt-in integration test, not by unit tests. We assert they conform to the `YtDlp` interface via TypeScript compilation.

- [ ] **Step 1: Implement search**

Create `src/lib/ytdlp/search.ts`:

```ts
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
```

- [ ] **Step 2: Implement resolve**

Create `src/lib/ytdlp/resolve.ts`:

```ts
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
```

- [ ] **Step 3: Implement download**

Create `src/lib/ytdlp/download.ts`:

```ts
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
```

- [ ] **Step 4: Wire up the implementation as a YtDlp instance**

Create `src/lib/ytdlp/index.ts`:

```ts
import type { YtDlp } from './types';
import { ytSearch } from './search';
import { ytResolve } from './resolve';
import { ytDownload } from './download';

export * from './types';
export { isBotChallenge } from './detect';

export const realYtDlp: YtDlp = {
  search: (q, limit) => ytSearch(q, limit),
  resolve: (id) => ytResolve(id),
  download: (id, p) => ytDownload(id, p),
};

let _impl: YtDlp = realYtDlp;

export function getYtDlp(): YtDlp { return _impl; }
export function setYtDlp(impl: YtDlp): void { _impl = impl; }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ytdlp/
git commit -m "feat(ytdlp): real subprocess implementations for search, resolve, download"
```

---

## Task 14: Session/auth (cookie + OIDC stub)

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/auth/oidc.ts`
- Test: `tests/unit/session.test.ts`

For this plan, OIDC is **scaffolded but stubbed** (returns null when env not set); a future task wires the actual flow. The session helper is the load-bearing piece.

- [ ] **Step 1: Write tests**

Create `tests/unit/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { registerGuest } from '@/lib/singers';
import { resolveSinger, COOKIE_NAME, STAGE_TAB_COOKIE } from '@/lib/auth/session';

describe('resolveSinger', () => {
  it('returns null with no cookies', async () => {
    const db = freshDb();
    expect(await resolveSinger(db, new Map())).toBeNull();
  });

  it('finds singer by guest cookie', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const cookies = new Map([[COOKIE_NAME, cookie_token]]);
    const out = await resolveSinger(db, cookies);
    expect(out?.id).toBe(singer.id);
  });

  it('returns null for unknown cookie', async () => {
    const db = freshDb();
    const cookies = new Map([[COOKIE_NAME, 'unknown']]);
    expect(await resolveSinger(db, cookies)).toBeNull();
  });
});

describe('cookie constants', () => {
  it('defines cookie names', () => {
    expect(COOKIE_NAME).toBeTruthy();
    expect(STAGE_TAB_COOKIE).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/session.test.ts`
Expected: failures.

- [ ] **Step 3: Implement session**

Create `src/lib/auth/session.ts`:

```ts
import type { DB } from '../db';
import type { Singer } from '../singers';
import { findByCookie } from '../singers';
import { tryGetMemberFromOidc } from './oidc';

export const COOKIE_NAME = 'karaoke_singer';
export const STAGE_TAB_COOKIE = 'karaoke_stage_tab';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type CookieMap = Map<string, string> | Record<string, string | undefined>;

function read(cookies: CookieMap, name: string): string | undefined {
  if (cookies instanceof Map) return cookies.get(name);
  return cookies[name];
}

export async function resolveSinger(db: DB, cookies: CookieMap): Promise<Singer | null> {
  const member = await tryGetMemberFromOidc(db, cookies);
  if (member) return member;
  const token = read(cookies, COOKIE_NAME);
  if (!token) return null;
  return findByCookie(db, token);
}

export function getStageTab(cookies: CookieMap): string | null {
  return read(cookies, STAGE_TAB_COOKIE) ?? null;
}
```

- [ ] **Step 4: Implement OIDC stub**

Create `src/lib/auth/oidc.ts`:

```ts
import type { DB } from '../db';
import type { Singer } from '../singers';

export async function tryGetMemberFromOidc(_db: DB, _cookies: unknown): Promise<Singer | null> {
  if (!process.env.OIDC_ISSUER) return null;
  // Real OIDC integration is deferred; stub returns null until wired.
  return null;
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm test -- tests/unit/session.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/ tests/unit/session.test.ts
git commit -m "feat(auth): cookie-based session resolution; OIDC scaffold (stub)"
```

---

## Task 15: API helpers — error responses, cookie parsing

**Files:**
- Create: `src/lib/api/respond.ts`
- Create: `src/lib/api/cookies.ts`
- Create: `tests/helpers/api-helpers.ts`

- [ ] **Step 1: Implement respond helpers**

Create `src/lib/api/respond.ts`:

```ts
export function jsonOk(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined ?? {}) },
  });
}

export function jsonError(code: string, message: string, status = 400, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined ?? {}) },
  });
}
```

- [ ] **Step 2: Implement cookie helpers**

Create `src/lib/api/cookies.ts`:

```ts
import { parse, serialize } from 'cookie';

export function cookiesFromRequest(req: Request): Map<string, string> {
  const header = req.headers.get('cookie') ?? '';
  const obj = parse(header);
  return new Map(Object.entries(obj).filter(([, v]) => v !== undefined) as [string, string][]);
}

export function setCookieHeader(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean } = {}): string {
  return serialize(name, value, {
    path: '/',
    httpOnly: opts.httpOnly ?? true,
    sameSite: 'lax',
    maxAge: opts.maxAge,
  });
}
```

- [ ] **Step 3: Test helper for synthetic requests**

Create `tests/helpers/api-helpers.ts`:

```ts
export function makeRequest(url: string, init: RequestInit & { cookies?: Record<string, string> } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookies) {
    const c = Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    headers.set('cookie', c);
  }
  return new Request(`http://localhost${url}`, { ...init, headers });
}

export async function readJson(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/ tests/helpers/api-helpers.ts
git commit -m "chore(api): response and cookie helpers"
```

---

## Task 16: API — search route

**Files:**
- Create: `src/app/api/search/route.ts`
- Test: `tests/api/search.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/api/search.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { GET } from '@/app/api/search/route';

let fake: FakeYtDlp;

beforeEach(() => {
  freshDb();
  fake = new FakeYtDlp();
  setYtDlp(fake);
});

describe('GET /api/search', () => {
  it('400 on missing query', async () => {
    const res = await GET(makeRequest('/api/search'));
    expect(res.status).toBe(400);
  });

  it('returns normalized search results', async () => {
    fake.searchResults = [
      { youtube_id: 'a', title: 'A', channel: 'Sing King', duration_sec: 200, thumbnail_url: 'http://t/a.jpg' },
    ];
    const spy = vi.spyOn(fake, 'search');
    const res = await GET(makeRequest('/api/search?q=Wonderwall'));
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith('Wonderwall karaoke', 10);
  });

  it('does not double-append karaoke', async () => {
    const spy = vi.spyOn(fake, 'search');
    await GET(makeRequest('/api/search?q=Wonderwall karaoke'));
    expect(spy).toHaveBeenCalledWith('Wonderwall karaoke', 10);
  });

  it('502 on bot challenge', async () => {
    fake.search = async () => { const { BotChallengeError } = await import('@/lib/ytdlp/types'); throw new BotChallengeError(); };
    const res = await GET(makeRequest('/api/search?q=hi'));
    expect(res.status).toBe(502);
    const body = await readJson(res);
    expect(body.code).toBe('bot_challenge');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/api/search.test.ts`
Expected: failures, route module missing.

- [ ] **Step 3: Implement route**

Create `src/app/api/search/route.ts`:

```ts
import { jsonOk, jsonError } from '@/lib/api/respond';
import { getYtDlp } from '@/lib/ytdlp';
import { BotChallengeError } from '@/lib/ytdlp/types';
import { normalizeQuery } from '@/lib/search-query';
import { getBus } from '@/lib/sse';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (!q || !q.trim()) return jsonError('bad_request', 'q is required', 400);
  try {
    const results = await getYtDlp().search(normalizeQuery(q), 10);
    return jsonOk({ results });
  } catch (err) {
    if (err instanceof BotChallengeError) {
      getBus().broadcast('bot_challenge', { detected_at: Date.now() });
      return jsonError('bot_challenge', 'YouTube is challenging requests; set YTDLP_COOKIES_FILE', 502);
    }
    return jsonError('upstream_error', String((err as Error).message), 500);
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/api/search.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/search/ tests/api/search.test.ts
git commit -m "feat(api): GET /api/search with karaoke normalization and bot-challenge detection"
```

---

## Task 17: API — singer routes (register, me, action)

**Files:**
- Create: `src/app/api/singer/route.ts`
- Create: `src/app/api/singer/me/route.ts`
- Create: `src/app/api/singer/action/route.ts`
- Create: `src/lib/veto-singleton.ts`
- Test: `tests/api/singer.test.ts`

- [ ] **Step 1: Create global veto store singleton**

Create `src/lib/veto-singleton.ts`:

```ts
import { VetoStore, type VetoEvent } from './veto';
import { getBus } from './sse';

let _store: VetoStore | null = null;

function emit(e: VetoEvent) {
  const bus = getBus();
  if (e.kind === 'pending') {
    bus.broadcast('veto.pending', { veto: e.veto });
  } else if (e.kind === 'approved') {
    bus.broadcast('veto.approved', { veto_id: e.veto_id, action: e.action, entry_id: e.entry_id });
  } else {
    bus.broadcast('veto.denied', { veto_id: e.veto_id });
  }
}

export function getVetoStore(): VetoStore {
  if (!_store) _store = new VetoStore(emit);
  return _store;
}

export function resetVetoStoreForTest(): void {
  _store = null;
}
```

- [ ] **Step 2: Write singer route tests**

Create `tests/api/singer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { POST as registerPOST } from '@/app/api/singer/route';
import { GET as meGET } from '@/app/api/singer/me/route';
import { POST as actionPOST } from '@/app/api/singer/action/route';
import { COOKIE_NAME } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus } from '@/lib/queue';
import { resetVetoStoreForTest } from '@/lib/veto-singleton';

beforeEach(() => { freshDb(); resetVetoStoreForTest(); });

describe('POST /api/singer', () => {
  it('registers a guest and sets cookie', async () => {
    const res = await registerPOST(makeRequest('/api/singer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Angelo' }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.singer.display_name).toBe('Angelo');
    expect(res.headers.get('set-cookie')).toContain(`${COOKIE_NAME}=`);
  });

  it('400 on empty name', async () => {
    const res = await registerPOST(makeRequest('/api/singer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: '' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/singer/me', () => {
  it('returns null without cookie', async () => {
    const res = await meGET(makeRequest('/api/singer/me'));
    const body = await readJson(res);
    expect(body.singer).toBeNull();
  });

  it('returns singer with cookie', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const res = await meGET(makeRequest('/api/singer/me', { cookies: { [COOKIE_NAME]: cookie_token } }));
    const body = await readJson(res);
    expect(body.singer.id).toBe(singer.id);
  });
});

describe('POST /api/singer/action', () => {
  it('403 if not the playing singer', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const other = registerGuest(db, 'B').singer;
    const e = enqueue(db, other.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restart', entry_id: e.id }),
    }));
    expect(res.status).toBe(403);
  });

  it('opens a veto when current singer requests', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restart', entry_id: e.id }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.veto_id).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test -- tests/api/singer.test.ts`
Expected: failures.

- [ ] **Step 4: Implement register route**

Create `src/app/api/singer/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { registerGuest } from '@/lib/singers';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { setCookieHeader } from '@/lib/api/cookies';
import { COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth/session';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const name = body?.display_name;
  if (typeof name !== 'string' || !name.trim()) return jsonError('bad_request', 'display_name required', 400);
  try {
    const { singer, cookie_token } = registerGuest(getDb(), name);
    return jsonOk({ singer }, {
      headers: { 'set-cookie': setCookieHeader(COOKIE_NAME, cookie_token, { maxAge: COOKIE_MAX_AGE }) },
    });
  } catch (err) {
    return jsonError('bad_request', (err as Error).message, 400);
  }
}
```

- [ ] **Step 5: Implement me route**

Create `src/app/api/singer/me/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { resolveSinger } from '@/lib/auth/session';
import { jsonOk } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';

export async function GET(req: Request): Promise<Response> {
  const singer = await resolveSinger(getDb(), cookiesFromRequest(req));
  return jsonOk({ singer });
}
```

- [ ] **Step 6: Implement action route**

Create `src/app/api/singer/action/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { resolveSinger } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { findEntry } from '@/lib/queue';
import { getVetoStore } from '@/lib/veto-singleton';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const action = body?.action;
  const entry_id = body?.entry_id;
  if (action !== 'restart' && action !== 'skip') return jsonError('bad_request', 'invalid action', 400);
  if (typeof entry_id !== 'string') return jsonError('bad_request', 'entry_id required', 400);

  const db = getDb();
  const singer = await resolveSinger(db, cookiesFromRequest(req));
  if (!singer) return jsonError('unauthorized', 'register first', 401);

  const entry = findEntry(db, entry_id);
  if (!entry) return jsonError('not_found', 'entry not found', 404);
  if (entry.status !== 'playing') return jsonError('conflict', 'entry is not playing', 409);
  if (entry.singer.id !== singer.id) return jsonError('forbidden', 'not your turn', 403);

  const veto = getVetoStore().open({ action, entry_id, singer_id: singer.id });
  return jsonOk({ veto_id: veto.id });
}
```

- [ ] **Step 7: Run to confirm pass**

Run: `npm test -- tests/api/singer.test.ts`
Expected: 6 passing.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/singer/ src/lib/veto-singleton.ts tests/api/singer.test.ts
git commit -m "feat(api): singer register, me, action routes; veto store singleton"
```

---

## Task 18: API — queue routes (GET, POST, DELETE)

**Files:**
- Create: `src/app/api/queue/route.ts`
- Create: `src/app/api/queue/[id]/route.ts`
- Test: `tests/api/queue.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/api/queue.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { GET, POST } from '@/app/api/queue/route';
import { DELETE } from '@/app/api/queue/[id]/route';
import { COOKIE_NAME } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue } from '@/lib/queue';

beforeEach(() => { freshDb(); });

describe('GET /api/queue', () => {
  it('returns empty queue', async () => {
    const res = await GET(makeRequest('/api/queue'));
    const body = await readJson(res);
    expect(body.entries).toEqual([]);
    expect(body.current).toBeNull();
    expect(body.mode).toBe('fifo');
  });

  it('returns queue snapshot', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    enqueue(db, singer.id, { youtube_id: 'y', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await GET(makeRequest('/api/queue'));
    const body = await readJson(res);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].title).toBe('X');
  });
});

describe('POST /api/queue', () => {
  it('401 without singer', async () => {
    const res = await POST(makeRequest('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ youtube_id: 'y', title: 'T' }),
    }));
    expect(res.status).toBe(401);
  });

  it('enqueues with singer cookie', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const res = await POST(makeRequest('/api/queue', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ youtube_id: 'yt1', title: 'Wonderwall', duration_sec: 240, thumbnail_url: null, channel: 'Sing King' }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.entry.title).toBe('Wonderwall');
    expect(body.entry.singer.display_name).toBe('A');
  });

  it('400 on missing fields', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const res = await POST(makeRequest('/api/queue', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'no id' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/queue/:id', () => {
  it('deletes own entry', async () => {
    const db = freshDb();
    const { cookie_token, singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await DELETE(makeRequest(`/api/queue/${e.id}`, {
      method: 'DELETE',
      cookies: { [COOKIE_NAME]: cookie_token },
    }), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(200);
  });

  it('403 deleting someone else\'s entry', async () => {
    const db = freshDb();
    const { cookie_token } = registerGuest(db, 'A');
    const other = registerGuest(db, 'B').singer;
    const e = enqueue(db, other.id, { youtube_id: 'y', title: 'X', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await DELETE(makeRequest(`/api/queue/${e.id}`, {
      method: 'DELETE',
      cookies: { [COOKIE_NAME]: cookie_token },
    }), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/api/queue.test.ts`
Expected: failures.

- [ ] **Step 3: Implement GET/POST**

Create `src/app/api/queue/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { resolveSinger } from '@/lib/auth/session';
import { enqueue, getActiveQueue, getCurrent } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { getBus } from '@/lib/sse';

export async function GET(_req: Request): Promise<Response> {
  const db = getDb();
  const settings = getSettings(db);
  const entries = getActiveQueue(db, settings.queue_mode);
  const current = getCurrent(db);
  return jsonOk({ entries, current, mode: settings.queue_mode });
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
  const settings = getSettings(db);
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
  return jsonOk({ entry });
}
```

- [ ] **Step 4: Implement DELETE**

Create `src/app/api/queue/[id]/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { resolveSinger, getStageTab } from '@/lib/auth/session';
import { getActiveStage } from '@/lib/stage';
import { findEntry, removeEntry, getActiveQueue, getCurrent } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { getBus } from '@/lib/sse';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const db = getDb();
  const cookies = cookiesFromRequest(req);
  const entry = findEntry(db, id);
  if (!entry) return jsonError('not_found', 'entry not found', 404);

  const singer = await resolveSinger(db, cookies);
  const stageTab = getStageTab(cookies);
  const activeStage = getActiveStage(db);
  const isStage = stageTab !== null && activeStage?.tab_id === stageTab;
  const isOwner = singer !== null && entry.singer.id === singer.id;

  if (!isStage && !isOwner) return jsonError('forbidden', 'cannot delete this entry', 403);

  if (!removeEntry(db, id)) return jsonError('conflict', 'entry no longer removable', 409);
  const settings = getSettings(db);
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
  return jsonOk({ ok: true });
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm test -- tests/api/queue.test.ts`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/queue/ tests/api/queue.test.ts
git commit -m "feat(api): GET/POST /api/queue and DELETE /api/queue/:id"
```

---

## Task 19: API — queue/stream SSE route

**Files:**
- Create: `src/app/api/queue/stream/route.ts`

The SSE route's stream lifecycle is hard to test as a unit; coverage comes from the integration test in Task 26. We unit-tested the bus already in Task 5.

- [ ] **Step 1: Implement**

Create `src/app/api/queue/stream/route.ts`:

```ts
import { getBus } from '@/lib/sse';
import { SseBus } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request): Promise<Response> {
  const bus = getBus();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(enc.encode(SseBus.format(event, data))); } catch { /* closed */ }
      };
      send('hello', { ts: Date.now() });
      const off = bus.subscribe(send);
      const ping = setInterval(() => send('ping', { ts: Date.now() }), 20_000);
      const close = () => { off(); clearInterval(ping); try { controller.close(); } catch {} };
      // Per Next.js 15 RouteHandler pattern, AbortSignal on the request triggers cleanup.
      _req.signal?.addEventListener('abort', close);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/queue/stream/
git commit -m "feat(api): SSE stream broadcasting queue and veto events"
```

---

## Task 20: API — stage routes

**Files:**
- Create: `src/app/api/stage/claim/route.ts`
- Create: `src/app/api/stage/release/route.ts`
- Create: `src/app/api/stage/heartbeat/route.ts`
- Create: `src/app/api/stage/action/route.ts`
- Test: `tests/api/stage.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/api/stage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { POST as claimPOST } from '@/app/api/stage/claim/route';
import { POST as releasePOST } from '@/app/api/stage/release/route';
import { POST as hbPOST } from '@/app/api/stage/heartbeat/route';
import { POST as actionPOST } from '@/app/api/stage/action/route';
import { STAGE_TAB_COOKIE } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus } from '@/lib/queue';

beforeEach(() => { freshDb(); });

describe('POST /api/stage/claim', () => {
  it('claims a fresh stage', async () => {
    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(`${STAGE_TAB_COOKIE}=tab-1`);
  });

  it('409 on second claim without force', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-2' }),
    }));
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.current.tab_id).toBe('tab-1');
  });

  it('force-claim bumps existing', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-2', force: true }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/stage/heartbeat', () => {
  it('updates heartbeat for active tab', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await hbPOST(makeRequest('/api/stage/heartbeat', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    expect(res.status).toBe(200);
  });

  it('404 for unknown tab', async () => {
    const res = await hbPOST(makeRequest('/api/stage/heartbeat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'nope' }),
    }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/stage/action', () => {
  it('403 without active stage cookie', async () => {
    const res = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pause' }),
    }));
    expect(res.status).toBe(403);
  });

  it('skip advances current playing entry', async () => {
    const db = freshDb();
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    markStatus(db, e.id, 'playing');
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await actionPOST(makeRequest('/api/stage/action', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/stage/release', () => {
  it('releases an active stage', async () => {
    await claimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    const res = await releasePOST(makeRequest('/api/stage/release', {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/api/stage.test.ts`
Expected: failures.

- [ ] **Step 3: Implement claim**

Create `src/app/api/stage/claim/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { setCookieHeader } from '@/lib/api/cookies';
import { STAGE_TAB_COOKIE, COOKIE_MAX_AGE } from '@/lib/auth/session';
import { claimStage } from '@/lib/stage';
import { getBus } from '@/lib/sse';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const tabId = body?.tab_id;
  if (typeof tabId !== 'string' || !tabId) return jsonError('bad_request', 'tab_id required', 400);

  const r = claimStage(getDb(), tabId, body?.force === true);
  if (r.kind === 'conflict') {
    return new Response(
      JSON.stringify({ error: 'stage already claimed', code: 'conflict', current: r.current }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    );
  }

  const bus = getBus();
  bus.broadcast('stage.claimed', { session: r.session });
  if (r.evicted) bus.broadcast('stage.evicted', { tab_id: r.evicted });
  return jsonOk({ ok: true }, {
    headers: { 'set-cookie': setCookieHeader(STAGE_TAB_COOKIE, tabId, { maxAge: COOKIE_MAX_AGE }) },
  });
}
```

- [ ] **Step 4: Implement release**

Create `src/app/api/stage/release/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { getStageTab } from '@/lib/auth/session';
import { releaseStage } from '@/lib/stage';
import { getBus } from '@/lib/sse';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const tabId = body?.tab_id ?? getStageTab(cookiesFromRequest(req));
  if (typeof tabId !== 'string' || !tabId) return jsonError('bad_request', 'tab_id required', 400);
  if (!releaseStage(getDb(), tabId)) return jsonError('not_found', 'no such stage', 404);
  getBus().broadcast('stage.released', {});
  return jsonOk({ ok: true });
}
```

- [ ] **Step 5: Implement heartbeat**

Create `src/app/api/stage/heartbeat/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { heartbeat } from '@/lib/stage';

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const tabId = body?.tab_id;
  if (typeof tabId !== 'string' || !tabId) return jsonError('bad_request', 'tab_id required', 400);
  if (!heartbeat(getDb(), tabId)) return jsonError('not_found', 'unknown tab', 404);
  return jsonOk({ ok: true });
}
```

- [ ] **Step 6: Implement action**

Create `src/app/api/stage/action/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { getStageTab } from '@/lib/auth/session';
import { getActiveStage } from '@/lib/stage';
import { getCurrent, markStatus, getActiveQueue } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { updateLastSang } from '@/lib/singers';
import { getBus } from '@/lib/sse';

const ACTIONS = ['skip', 'restart', 'pause', 'resume', 'seek'] as const;

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  const cookies = cookiesFromRequest(req);
  const tabId = getStageTab(cookies);
  const active = getActiveStage(db);
  if (!tabId || !active || active.tab_id !== tabId) return jsonError('forbidden', 'not the active stage', 403);

  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const action = body?.action;
  if (!ACTIONS.includes(action)) return jsonError('bad_request', 'invalid action', 400);

  const current = getCurrent(db);
  const bus = getBus();
  const settings = getSettings(db);

  if (action === 'skip') {
    if (current) markStatus(db, current.id, 'skipped');
  } else if (action === 'restart') {
    // Stage tab applies the actual seek client-side; server logs and broadcasts.
  } else if (action === 'pause' || action === 'resume') {
    // Same — stage tab is authoritative on player state.
  } else if (action === 'seek') {
    // Same.
  }

  bus.broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
  bus.broadcast('stage.action', { action, value: body.value ?? null });
  return jsonOk({ ok: true });
}
```

- [ ] **Step 7: Run to confirm pass**

Run: `npm test -- tests/api/stage.test.ts`
Expected: 8 passing.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/stage/ tests/api/stage.test.ts
git commit -m "feat(api): stage claim, release, heartbeat, action with TTL and force-claim"
```

---

## Task 21: API — veto route + advance integration

**Files:**
- Create: `src/app/api/veto/[id]/route.ts`
- Modify: `src/lib/veto-singleton.ts` (apply approved actions)
- Test: `tests/api/veto.test.ts`

- [ ] **Step 1: Update veto-singleton to apply approved actions**

Modify `src/lib/veto-singleton.ts`:

```ts
import { VetoStore, type VetoEvent } from './veto';
import { getBus } from './sse';
import { getDb } from './db';
import { findEntry, markStatus, getActiveQueue, getCurrent } from './queue';
import { getSettings } from './settings';
import { updateLastSang } from './singers';

let _store: VetoStore | null = null;

function applyApproval(entryId: string, action: 'restart' | 'skip') {
  const db = getDb();
  const entry = findEntry(db, entryId);
  if (!entry) return;
  if (action === 'skip') {
    markStatus(db, entry.id, 'skipped');
    if (entry.singer.id) updateLastSang(db, entry.singer.id, Date.now());
  }
  // 'restart' is applied client-side by the stage tab seeking to 0; we just signal via SSE.
  const settings = getSettings(db);
  getBus().broadcast('queue.updated', { entries: getActiveQueue(db, settings.queue_mode), current: getCurrent(db) });
}

function emit(e: VetoEvent) {
  const bus = getBus();
  if (e.kind === 'pending') {
    bus.broadcast('veto.pending', { veto: e.veto });
  } else if (e.kind === 'approved') {
    bus.broadcast('veto.approved', { veto_id: e.veto_id, action: e.action, entry_id: e.entry_id });
    applyApproval(e.entry_id, e.action);
  } else {
    bus.broadcast('veto.denied', { veto_id: e.veto_id });
  }
}

export function getVetoStore(): VetoStore {
  if (!_store) _store = new VetoStore(emit);
  return _store;
}

export function resetVetoStoreForTest(): void {
  _store = null;
}
```

- [ ] **Step 2: Write tests**

Create `tests/api/veto.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { POST as actionPOST } from '@/app/api/singer/action/route';
import { POST as vetoPOST } from '@/app/api/veto/[id]/route';
import { POST as stageClaimPOST } from '@/app/api/stage/claim/route';
import { COOKIE_NAME, STAGE_TAB_COOKIE } from '@/lib/auth/session';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus, findEntry } from '@/lib/queue';
import { resetVetoStoreForTest } from '@/lib/veto-singleton';

beforeEach(() => { vi.useFakeTimers(); freshDb(); resetVetoStoreForTest(); });
afterEach(() => vi.useRealTimers());

async function setupPlaying() {
  const db = freshDb();
  resetVetoStoreForTest();
  const { cookie_token, singer } = registerGuest(db, 'A');
  const e = enqueue(db, singer.id, { youtube_id: 'y', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
  markStatus(db, e.id, 'playing');
  await stageClaimPOST(makeRequest('/api/stage/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: 'tab-1' }),
  }));
  return { db, cookie_token, entry_id: e.id };
}

describe('veto flow', () => {
  it('singer requests skip, stage allows, entry gets skipped', async () => {
    const { db, cookie_token, entry_id } = await setupPlaying();
    const req = makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    });
    const res = await actionPOST(req);
    const { veto_id } = await readJson(res);

    const decideRes = await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(decideRes.status).toBe(200);
    const e = findEntry(db, entry_id);
    expect(e?.status).toBe('skipped');
  });

  it('singer requests skip, stage denies, entry stays playing', async () => {
    const { db, cookie_token, entry_id } = await setupPlaying();
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    }));
    const { veto_id } = await readJson(res);
    await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'deny' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(findEntry(db, entry_id)?.status).toBe('playing');
  });

  it('timeout auto-approves after 5s', async () => {
    const { db, cookie_token, entry_id } = await setupPlaying();
    await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    }));
    vi.advanceTimersByTime(5_100);
    expect(findEntry(db, entry_id)?.status).toBe('skipped');
  });

  it('403 vetoing without stage cookie', async () => {
    const { cookie_token, entry_id } = await setupPlaying();
    const res = await actionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookie_token },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip', entry_id }),
    }));
    const { veto_id } = await readJson(res);
    const decide = await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(decide.status).toBe(403);
  });
});
```

- [ ] **Step 3: Implement veto route**

Create `src/app/api/veto/[id]/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { cookiesFromRequest } from '@/lib/api/cookies';
import { getStageTab } from '@/lib/auth/session';
import { getActiveStage } from '@/lib/stage';
import { getVetoStore } from '@/lib/veto-singleton';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const db = getDb();
  const cookies = cookiesFromRequest(req);
  const tabId = getStageTab(cookies);
  const active = getActiveStage(db);
  if (!tabId || !active || active.tab_id !== tabId) return jsonError('forbidden', 'not the active stage', 403);

  const { id } = await ctx.params;
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  const decision = body?.decision;
  if (decision !== 'allow' && decision !== 'deny') return jsonError('bad_request', 'invalid decision', 400);

  const result = getVetoStore().decide(id, decision);
  if (result === 'unknown') return jsonError('not_found', 'veto expired or unknown', 404);
  return jsonOk({ ok: true });
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/api/veto.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/veto/ src/lib/veto-singleton.ts tests/api/veto.test.ts
git commit -m "feat(api): veto decision route; approved skip applies to queue"
```

---

## Task 22: API — settings routes

**Files:**
- Create: `src/app/api/settings/route.ts`
- Test: `tests/api/settings.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/api/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from '../helpers/test-db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { GET, PUT } from '@/app/api/settings/route';

beforeEach(() => { freshDb(); });

describe('settings api', () => {
  it('GET returns defaults', async () => {
    const res = await GET();
    const body = await readJson(res);
    expect(body.queue_mode).toBe('fifo');
    expect(body.stage_immersive).toBe(false);
  });

  it('PUT updates queue_mode', async () => {
    const res = await PUT(makeRequest('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queue_mode: 'round_robin' }),
    }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.settings.queue_mode).toBe('round_robin');
  });

  it('PUT 400 on invalid value', async () => {
    const res = await PUT(makeRequest('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queue_mode: 'bogus' }),
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/api/settings.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/app/api/settings/route.ts`:

```ts
import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { getSettings, updateSettings } from '@/lib/settings';
import { getBus } from '@/lib/sse';

export async function GET(): Promise<Response> {
  return jsonOk(getSettings(getDb()));
}

export async function PUT(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  try {
    const settings = updateSettings(getDb(), body);
    getBus().broadcast('settings.updated', settings);
    return jsonOk({ settings });
  } catch (err) {
    return jsonError('bad_request', (err as Error).message, 400);
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/api/settings.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/ tests/api/settings.test.ts
git commit -m "feat(api): GET/PUT /api/settings"
```

---

## Task 23: API — cache route with Range support

**Files:**
- Create: `src/app/api/cache/[id]/route.ts`
- Test: `tests/api/cache.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/api/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { freshDb } from '../helpers/test-db';
import { makeRequest } from '../helpers/api-helpers';
import { GET } from '@/app/api/cache/[id]/route';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { registerGuest } from '@/lib/singers';
import { enqueue, markStatus } from '@/lib/queue';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-api-'));
  process.env.CACHE_DIR = dir;
  freshDb();
  setYtDlp(new FakeYtDlp());
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('GET /api/cache/:id', () => {
  it('404 when entry missing', async () => {
    const res = await GET(makeRequest('/api/cache/nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('serves file when cache_path set', async () => {
    const db = freshDb();
    setYtDlp(new FakeYtDlp());
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    const file = path.join(dir, 'yt1.mp4');
    fs.writeFileSync(file, Buffer.from('hello world'));
    markStatus(db, e.id, 'ready', { cache_path: file } as any);
    const res = await GET(makeRequest(`/api/cache/${e.id}`), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe('hello world');
  });

  it('returns 206 with Range', async () => {
    const db = freshDb();
    setYtDlp(new FakeYtDlp());
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    const file = path.join(dir, 'yt1.mp4');
    fs.writeFileSync(file, Buffer.from('0123456789'));
    markStatus(db, e.id, 'ready', { cache_path: file } as any);
    const res = await GET(makeRequest(`/api/cache/${e.id}`, { headers: { range: 'bytes=2-5' } }), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(206);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe('2345');
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
  });

  it('falls back via 302 when no cache file and ?fallback=1', async () => {
    const db = freshDb();
    const fake = new FakeYtDlp();
    fake.resolveUrl = 'https://signed.example/video.mp4';
    setYtDlp(fake);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    const res = await GET(makeRequest(`/api/cache/${e.id}?fallback=1`), { params: Promise.resolve({ id: e.id }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://signed.example/video.mp4');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/api/cache.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/app/api/cache/[id]/route.ts`:

```ts
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
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- tests/api/cache.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cache/ tests/api/cache.test.ts
git commit -m "feat(api): /api/cache/:id serves mp4 with Range; fallback to streamed URL"
```

---

## Task 24: Download worker

**Files:**
- Create: `src/lib/worker/download-worker.ts`
- Modify: `src/app/api/queue/route.ts` (kick worker on enqueue)
- Test: `tests/unit/download-worker.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/download-worker.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { freshDb } from '../helpers/test-db';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { registerGuest } from '@/lib/singers';
import { enqueue, findEntry } from '@/lib/queue';
import { runWorkerOnce } from '@/lib/worker/download-worker';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-w-'));
  process.env.CACHE_DIR = dir;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('download worker', () => {
  it('downloads a queued entry and flips status to ready', async () => {
    const db = freshDb();
    const fake = new FakeYtDlp();
    setYtDlp(fake);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    await runWorkerOnce();
    const after = findEntry(db, e.id);
    expect(after?.status).toBe('ready');
    expect(fake.downloadCalls).toHaveLength(1);
  });

  it('marks failed on download error', async () => {
    const db = freshDb();
    const fake = new FakeYtDlp();
    fake.downloadShouldFail = true;
    setYtDlp(fake);
    const { singer } = registerGuest(db, 'A');
    const e = enqueue(db, singer.id, { youtube_id: 'yt1', title: 't', channel: null, duration_sec: null, thumbnail_url: null });
    await runWorkerOnce();
    const after = findEntry(db, e.id);
    expect(after?.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/download-worker.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

Create `src/lib/worker/download-worker.ts`:

```ts
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
```

- [ ] **Step 4: Wire `kickWorker()` into enqueue**

Edit `src/app/api/queue/route.ts` — at the top add:

```ts
import { kickWorker } from '@/lib/worker/download-worker';
```

In the `POST` function, after `const entry = enqueue(...)`, add:

```ts
kickWorker();
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm test -- tests/unit/download-worker.test.ts`
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/worker/ src/app/api/queue/route.ts tests/unit/download-worker.test.ts
git commit -m "feat(worker): drain queued -> downloading -> ready; evict cache; signal bot challenge"
```

---

## Task 25: Scaffold debug pages

**Files:**
- Create: `src/app/page.tsx`
- Create: `src/app/stage/page.tsx`

These are not production UI. They expose enough buttons + raw JSON to verify every API endpoint works end-to-end. The UI agent will replace both later.

- [ ] **Step 1: Implement phone scaffold**

Create `src/app/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

type AnyJson = any;

export default function PhoneScaffold() {
  const [me, setMe] = useState<AnyJson>(null);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AnyJson[]>([]);
  const [queue, setQueue] = useState<AnyJson | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  async function refresh() {
    setMe(await (await fetch('/api/singer/me')).json());
    setQueue(await (await fetch('/api/queue')).json());
  }

  useEffect(() => {
    refresh();
    const es = new EventSource('/api/queue/stream');
    es.onmessage = (e) => setEvents((arr) => [`message: ${e.data}`, ...arr].slice(0, 50));
    es.addEventListener('queue.updated', (e: any) => { setEvents((arr) => [`queue.updated`, ...arr].slice(0, 50)); refresh(); });
    es.addEventListener('veto.pending', (e: any) => setEvents((arr) => [`veto.pending: ${e.data}`, ...arr].slice(0, 50)));
    return () => es.close();
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'monospace' }}>
      <h1>Karaoke debug — phone</h1>
      <section>
        <h2>singer/me</h2>
        <pre>{JSON.stringify(me, null, 2)}</pre>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="display name" />
        <button onClick={async () => { await fetch('/api/singer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: name }) }); refresh(); }}>register</button>
      </section>
      <section>
        <h2>search</h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={async () => {
          const r = await (await fetch(`/api/search?q=${encodeURIComponent(search)}`)).json();
          setResults(r.results ?? []);
        }}>search</button>
        <ul>
          {results.map((r) => (
            <li key={r.youtube_id}>
              {r.title} — {r.channel}
              <button onClick={async () => {
                await fetch('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) });
              }}>queue</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>queue</h2>
        <pre>{JSON.stringify(queue, null, 2)}</pre>
      </section>
      <section>
        <h2>events</h2>
        <ul>{events.map((e, i) => <li key={i}>{e}</li>)}</ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Implement stage scaffold**

Create `src/app/stage/page.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

export default function StageScaffold() {
  const [tabId] = useState(() => crypto.randomUUID());
  const [claimed, setClaimed] = useState(false);
  const [queue, setQueue] = useState<any>(null);
  const [pendingVeto, setPendingVeto] = useState<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function refresh() {
    setQueue(await (await fetch('/api/queue')).json());
  }

  useEffect(() => {
    if (!claimed) return;
    const hb = setInterval(() => fetch('/api/stage/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: tabId }) }), 10_000);
    refresh();
    const es = new EventSource('/api/queue/stream');
    es.addEventListener('queue.updated', () => refresh());
    es.addEventListener('veto.pending', (e: any) => setPendingVeto(JSON.parse(e.data).veto));
    es.addEventListener('veto.approved', (e: any) => { setPendingVeto(null); const d = JSON.parse(e.data); if (d.action === 'restart' && videoRef.current) videoRef.current.currentTime = 0; });
    es.addEventListener('veto.denied', () => setPendingVeto(null));
    return () => { clearInterval(hb); es.close(); };
  }, [claimed, tabId]);

  async function claim(force = false) {
    const r = await fetch('/api/stage/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab_id: tabId, force }) });
    if (r.ok) setClaimed(true);
    else alert('conflict — pass force to bump');
  }

  const next = queue?.entries?.[0];

  return (
    <main style={{ padding: 16, fontFamily: 'monospace' }}>
      <h1>Stage debug</h1>
      {!claimed && <button onClick={() => claim(false)}>claim</button>}
      {!claimed && <button onClick={() => claim(true)}>force claim</button>}
      {claimed && (
        <>
          <p>tab: {tabId}</p>
          {queue?.current && (
            <video ref={videoRef} src={`/api/cache/${queue.current.id}`} controls autoPlay onEnded={() => fetch('/api/stage/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'skip' }) })} />
          )}
          {next && !queue?.current && <p>next up: {next.title}</p>}
          {pendingVeto && (
            <div style={{ border: '2px solid red', padding: 8 }}>
              {pendingVeto.singer_id} wants to {pendingVeto.action}
              <button onClick={() => fetch(`/api/veto/${pendingVeto.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'allow' }) })}>allow</button>
              <button onClick={() => fetch(`/api/veto/${pendingVeto.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'deny' }) })}>deny</button>
            </div>
          )}
          <pre>{JSON.stringify(queue, null, 2)}</pre>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/stage/page.tsx
git commit -m "feat(scaffold): debug phone and stage pages exercising every API"
```

---

## Task 26: Integration test (full flow)

**Files:**
- Create: `tests/integration/full-flow.test.ts`

This drives every API in sequence with the in-memory DB and fake yt-dlp. Verifies the contract end-to-end without a browser. Gated behind `RUN_INTEGRATION=1`.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/full-flow.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setDbForTest, openMemoryDb, type DB } from '@/lib/db';
import { makeRequest, readJson } from '../helpers/api-helpers';
import { setYtDlp } from '@/lib/ytdlp';
import { FakeYtDlp } from '../helpers/fake-ytdlp';
import { POST as singerPOST } from '@/app/api/singer/route';
import { GET as searchGET } from '@/app/api/search/route';
import { POST as queuePOST } from '@/app/api/queue/route';
import { POST as stageClaimPOST } from '@/app/api/stage/claim/route';
import { POST as singerActionPOST } from '@/app/api/singer/action/route';
import { POST as vetoPOST } from '@/app/api/veto/[id]/route';
import { COOKIE_NAME, STAGE_TAB_COOKIE } from '@/lib/auth/session';
import { findEntry, markStatus } from '@/lib/queue';
import { resetVetoStoreForTest } from '@/lib/veto-singleton';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const enabled = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!enabled)('full flow integration', () => {
  let dir: string;
  let fake: FakeYtDlp;
  let db: DB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-int-'));
    process.env.CACHE_DIR = dir;
    db = openMemoryDb();
    setDbForTest(db);
    resetVetoStoreForTest();
    fake = new FakeYtDlp();
    fake.searchResults = [{ youtube_id: 'yt1', title: 'Wonderwall (karaoke)', channel: 'Sing King', duration_sec: 240, thumbnail_url: null }];
    setYtDlp(fake);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('full singer-driven veto flow', async () => {
    // Register
    const reg = await singerPOST(makeRequest('/api/singer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Angelo' }),
    }));
    const cookieToken = /karaoke_singer=([^;]+)/.exec(reg.headers.get('set-cookie')!)![1];

    // Search and enqueue
    const sres = await searchGET(makeRequest('/api/search?q=Wonderwall'));
    const sbody = await readJson(sres);
    const eres = await queuePOST(makeRequest('/api/queue', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookieToken },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sbody.results[0]),
    }));
    const entryId = (await readJson(eres)).entry.id;

    // Wait for download worker microtask
    await new Promise((r) => setImmediate(r));
    expect(fake.downloadCalls.length).toBeGreaterThan(0);
    expect(findEntry(db, entryId)?.status).toBe('ready');

    // Stage claim and start playing
    await stageClaimPOST(makeRequest('/api/stage/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab_id: 'tab-1' }),
    }));
    markStatus(db, entryId, 'playing');

    // Singer requests restart
    const ares = await singerActionPOST(makeRequest('/api/singer/action', {
      method: 'POST',
      cookies: { [COOKIE_NAME]: cookieToken },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restart', entry_id: entryId }),
    }));
    const { veto_id } = await readJson(ares);

    // Stage allows
    const dres = await vetoPOST(makeRequest(`/api/veto/${veto_id}`, {
      method: 'POST',
      cookies: { [STAGE_TAB_COOKIE]: 'tab-1' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    }), { params: Promise.resolve({ id: veto_id }) });
    expect(dres.status).toBe(200);

    // Restart leaves entry as 'playing' (client-side seek, no server transition)
    expect(findEntry(db, entryId)?.status).toBe('playing');
  });
});
```

- [ ] **Step 2: Run**

Run: `RUN_INTEGRATION=1 npm test -- tests/integration/full-flow.test.ts`
Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/full-flow.test.ts
git commit -m "test(integration): full singer veto flow gated behind RUN_INTEGRATION=1"
```

---

## Task 27: Final smoke — full test suite + build

**Files:** none (verification only)

- [ ] **Step 1: Run all unit + API tests**

Run: `npm test`
Expected: all green. Record total count.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run Next.js build**

Run: `npm run build`
Expected: succeeds. Warnings about Tailwind unused / missing OIDC env are fine.

- [ ] **Step 4: Manual smoke (optional)**

Run: `npm run dev`
Open `http://localhost:3000` (phone scaffold) and `http://localhost:3000/stage` (stage scaffold) in two tabs. Register a name on the phone, search for "Bohemian Rhapsody", enqueue. The stage tab should show the queue. Skip via stage button. Confirm SSE updates both views.

This is end-of-plan acceptance — UI is throwaway, but every API path has been exercised.

- [ ] **Step 5: Commit any final fixes (if needed)**

```bash
git status
# fix anything build surfaced
git add -p
git commit -m "fix: <description>"
```

---

## Plan complete

The backend, library, API, and SSE event surface defined in the spec are implemented and tested. The UI agent can take over by replacing `src/app/page.tsx` and `src/app/stage/page.tsx` against the documented API contract; nothing else needs to change.

