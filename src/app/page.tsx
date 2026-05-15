'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconCheck,
  IconMic,
  IconPlus,
  IconRestart,
  IconSearch,
  IconSkip,
  IconTrash,
  IconUser,
  IconUsers,
  IconX,
  IconYouTube,
} from './components/icons';

type Singer = { id: string; display_name: string; kind: 'member' | 'guest' };

type SearchResult = {
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec?: number | null;
  thumbnail_url?: string | null;
};

type QueueEntry = {
  id: string;
  youtube_id: string;
  title: string;
  channel: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  status: 'queued' | 'downloading' | 'ready' | 'playing' | 'played' | 'skipped' | 'failed';
  singer: { id: string; display_name: string };
};

type QueueState = { entries: QueueEntry[]; current: QueueEntry | null; mode: 'fifo' | 'round_robin'; paused: boolean };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '·';

const fmtDuration = (s: number | null | undefined) => {
  if (!s || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
};

export default function PhonePage() {
  const [singer, setSinger] = useState<Singer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [queue, setQueue] = useState<QueueState | null>(null);

  const refresh = useCallback(async () => {
    const [meRes, qRes] = await Promise.all([
      fetch('/api/singer/me').then((r) => r.json()).catch(() => ({ singer: null })),
      fetch('/api/queue').then((r) => r.json()).catch(() => null),
    ]);
    setSinger(meRes?.singer ?? null);
    if (qRes && !qRes.error) setQueue(qRes);
    setLoaded(true);
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    refreshRef.current();
    let es: EventSource | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (cancelled) return;
      es = new EventSource('/api/queue/stream');
      const onUpdate = () => refreshRef.current();
      let stageActionTimer: ReturnType<typeof setTimeout> | null = null;
      const onStageAction = () => {
        if (stageActionTimer) clearTimeout(stageActionTimer);
        stageActionTimer = setTimeout(() => refreshRef.current(), 200);
      };
      es.addEventListener('queue.updated', onUpdate);
      es.addEventListener('stage.action', onStageAction);
      es.onerror = () => {
        if (es) {
          es.close();
          es = null;
        }
        if (!cancelled) {
          if (retry) clearTimeout(retry);
          retry = setTimeout(connect, 1500);
        }
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);

  if (!loaded) {
    return (
      <main className="relative z-10 min-h-dvh flex items-center justify-center px-6">
        <div className="glass-pill px-5 py-3 text-sm text-zinc-400">Connecting…</div>
      </main>
    );
  }

  if (!singer) {
    return <RegisterScreen onRegistered={refresh} />;
  }

  return <SignedInView singer={singer} queue={queue} onChange={refresh} />;
}

/* -------------------------------------------------------------------------- */

function RegisterScreen({ onRegistered }: { onRegistered: () => void }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/singer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: trimmed }),
      });
      const body = await r.json();
      if (!r.ok || body.error) {
        setError(body?.message ?? 'could not register');
      } else {
        onRegistered();
      }
    } catch {
      setError('network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative z-10 min-h-dvh flex items-center justify-center px-5 py-10">
      <div className="glass-panel w-full max-w-md rounded-3xl p-8 slide-in">
        <div className="flex items-center gap-2 text-emerald-400/80 text-[11px] uppercase tracking-[0.22em] font-semibold mb-6">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          Karaoke • Live
        </div>
        <h1 className="text-3xl font-medium tracking-tight text-gradient-soft leading-tight mb-2">
          What should we call you?
        </h1>
        <p className="text-sm text-zinc-400 mb-8 font-light">
          Pick a name so the room knows who's up next.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="glass-input rounded-2xl flex items-center px-4 py-3.5">
            <IconUser className="w-5 h-5 text-zinc-400 mr-3" />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              maxLength={32}
              className="bg-transparent w-full outline-none text-zinc-100 placeholder:text-zinc-500 font-light text-base"
            />
          </label>
          {error && <p className="text-xs text-rose-400 px-1">{error}</p>}
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="glass-button rounded-2xl px-5 py-3.5 text-sm font-medium tracking-wide text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Registering…' : 'Enter the room'}
          </button>
        </form>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function SignedInView({
  singer,
  queue,
  onChange,
}: {
  singer: Singer;
  queue: QueueState | null;
  onChange: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const current = queue?.current ?? null;
  const upNext = useMemo(
    () => (queue?.entries ?? []).filter((e) => e.id !== current?.id),
    [queue, current],
  );
  const isMyTurn = !!(current && current.singer.id === singer.id);

  return (
    <>
      <main
        className={`relative z-10 mx-auto w-full max-w-xl min-h-dvh flex flex-col px-4 pt-10 sm:pt-14 pb-40 transition-[filter,transform] duration-400 ${
          searchOpen ? 'blur-sm brightness-[0.4] scale-[0.98]' : ''
        }`}
      >
        <header className="flex items-center justify-between gap-4 mb-8 slide-in">
          <div className="glass-pill px-4 py-2 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-600 flex items-center justify-center text-[11px] font-semibold border border-white/20">
              {initials(singer.display_name)}
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold mb-0.5">
                You are
              </span>
              <span className="text-sm font-medium tracking-wide text-zinc-100">
                {singer.display_name}
              </span>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 font-semibold">
            {queue?.mode === 'round_robin' ? 'Round robin' : 'FIFO'}
          </span>
        </header>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="glass-input w-full rounded-2xl flex items-center px-4 py-4 mb-10 text-left slide-in"
          style={{ animationDelay: '60ms' }}
        >
          <IconSearch className="w-5 h-5 text-zinc-400 mr-3 shrink-0" />
          <span className="text-zinc-500 font-light text-base">Find a song on YouTube…</span>
        </button>

        <NowPlayingCard current={current} upNext={upNext.length} paused={queue?.paused ?? false} />

        <UpNextList
          entries={upNext}
          singer={singer}
          onChange={onChange}
        />
      </main>

      {searchOpen && (
        <SearchOverlay onClose={() => setSearchOpen(false)} onQueued={onChange} />
      )}

      {isMyTurn && current && (
        <VetoBar entry={current} onAfterAction={onChange} />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function NowPlayingCard({
  current,
  upNext,
  paused,
}: {
  current: QueueEntry | null;
  upNext: number;
  paused: boolean;
}) {
  return (
    <section className="mb-10 slide-in" style={{ animationDelay: '120ms' }}>
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="text-[11px] uppercase tracking-[0.22em] font-bold text-zinc-400 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${paused ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.7)]' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)] pulse-soft'}`} />
          {current ? (paused ? 'Paused' : 'Live stage') : 'Stage idle'}
        </div>
        {current && !paused && (
          <div className="flex items-end gap-1 h-4 text-emerald-400">
            <span className="eq-bar h-3" style={{ animationDuration: '1.1s' }} />
            <span className="eq-bar h-4" style={{ animationDuration: '0.8s', animationDelay: '0.1s' }} />
            <span className="eq-bar h-2.5" style={{ animationDuration: '1.4s', animationDelay: '0.2s' }} />
          </div>
        )}
      </div>

      <div className="relative w-full rounded-[2rem] glass-panel overflow-hidden p-6 min-h-[220px] flex flex-col justify-end">
        {current?.thumbnail_url && (
          <div
            className="absolute inset-0 opacity-30 saturate-150"
            style={{
              backgroundImage: `url(${current.thumbnail_url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(6px)',
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian/95 via-obsidian/40 to-transparent" />

        <div className="relative z-10 flex flex-col w-full">
          {current ? (
            <>
              <div className="self-start mb-3 bg-white/10 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-full flex items-center gap-2">
                <IconMic className="w-3.5 h-3.5 text-rose-300" />
                <span className="text-xs font-medium tracking-wide">
                  {current.singer.display_name}
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-gradient-soft leading-tight mb-1.5 line-clamp-2">
                {current.title}
              </h1>
              {current.channel && (
                <p className="text-zinc-300 font-light text-sm flex items-center gap-2">
                  <IconYouTube className="w-4 h-4 text-zinc-400" />
                  <span className="truncate">{current.channel}</span>
                </p>
              )}
            </>
          ) : (
            <>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-gradient-soft mb-1.5">
                Nothing's playing
              </h1>
              <p className="text-zinc-400 font-light text-sm">
                {upNext > 0
                  ? `${upNext} song${upNext === 1 ? '' : 's'} waiting — the stage will start them up.`
                  : 'Search a song to get the night started.'}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function UpNextList({
  entries,
  singer,
  onChange,
}: {
  entries: QueueEntry[];
  singer: Singer;
  onChange: () => void;
}) {
  return (
    <section className="slide-in flex-1" style={{ animationDelay: '180ms' }}>
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-[11px] uppercase tracking-[0.22em] font-bold text-zinc-400">
          Up next
        </h2>
        <span className="text-[11px] text-zinc-500 font-medium">
          {entries.length} {entries.length === 1 ? 'track' : 'tracks'}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="glass-subtle rounded-2xl px-5 py-8 text-center">
          <p className="text-sm text-zinc-500 font-light">
            Queue is empty. Be the one who breaks the silence.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => {
            const isMine = entry.singer.id === singer.id;
            const dur = fmtDuration(entry.duration_sec);
            return (
              <li
                key={entry.id}
                className="glass-button p-3 pr-2 rounded-2xl flex items-center gap-3"
              >
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 overflow-hidden flex-shrink-0 relative">
                  {entry.thumbnail_url ? (
                    <img
                      src={entry.thumbnail_url}
                      alt=""
                      className="w-full h-full object-cover opacity-70"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-zinc-600">
                      <IconYouTube className="w-5 h-5" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-medium text-zinc-100 truncate leading-tight">
                    {entry.title}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
                    {entry.channel && (
                      <span className="truncate min-w-0">{entry.channel}</span>
                    )}
                    {entry.channel && (
                      <span className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
                    )}
                    <span
                      className={`flex items-center gap-1 font-medium shrink-0 ${
                        isMine ? 'text-purple-300' : 'text-zinc-400'
                      }`}
                    >
                      <IconUser className="w-3.5 h-3.5" />
                      {isMine ? 'You' : entry.singer.display_name}
                    </span>
                    {dur && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
                        <span className="font-mono text-zinc-500 shrink-0">{dur}</span>
                      </>
                    )}
                  </div>
                  <StatusChip status={entry.status} />
                </div>
                {isMine && (
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/queue/${entry.id}`, { method: 'DELETE' });
                      onChange();
                    }}
                    className="w-9 h-9 rounded-full text-zinc-500 hover:text-rose-300 hover:bg-rose-500/10 transition flex items-center justify-center"
                    aria-label="Remove from queue"
                  >
                    <IconTrash className="w-4 h-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: QueueEntry['status'] }) {
  if (status === 'queued' || status === 'ready') return null;
  const labels: Record<string, { text: string; cls: string }> = {
    downloading: { text: 'Downloading', cls: 'text-amber-300/90' },
    playing: { text: 'Playing', cls: 'text-emerald-300' },
    played: { text: 'Played', cls: 'text-zinc-500' },
    skipped: { text: 'Skipped', cls: 'text-zinc-500' },
    failed: { text: 'Failed', cls: 'text-rose-400' },
  };
  const meta = labels[status];
  if (!meta) return null;
  return (
    <span className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${meta.cls} mt-1 inline-block`}>
      {meta.text}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

function SearchOverlay({
  onClose,
  onQueued,
}: {
  onClose: () => void;
  onQueued: () => void;
}) {
  const [value, setValue] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQuery = useRef<string>('');

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  async function search(q: string) {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    lastQuery.current = q;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((res) => res.json());
      if (lastQuery.current !== q) return;
      if (r.error) {
        setError(r.message ?? 'search failed');
        setResults([]);
      } else {
        setResults(r.results ?? []);
      }
    } catch {
      setError('network error');
    } finally {
      if (lastQuery.current === q) setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    search(value);
  }

  async function queueResult(r: SearchResult) {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    if (res.ok) {
      setQueuedIds((s) => new Set(s).add(r.youtube_id));
      onQueued();
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col px-4 pt-10 sm:pt-14 pb-6">
      <div className="mx-auto w-full max-w-xl flex flex-col gap-3 h-full">
        <form onSubmit={onSubmit} className="glass-input rounded-2xl flex items-center px-4 py-3.5 slide-in">
          <IconSearch className="w-5 h-5 text-zinc-400 mr-3 shrink-0" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search karaoke versions on YouTube…"
            className="bg-transparent w-full outline-none text-zinc-100 placeholder:text-zinc-500 font-light text-base"
          />
          <button
            type="button"
            onClick={onClose}
            className="ml-2 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white grid place-items-center transition"
            aria-label="Close search"
          >
            <IconX className="w-4 h-4" />
          </button>
        </form>

        <div className="glass-panel flex-1 rounded-3xl overflow-hidden flex flex-col slide-in" style={{ animationDelay: '60ms' }}>
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] font-semibold text-zinc-500">
            {value.trim() ? (
              <>
                <span>
                  {loading ? 'Searching' : `Results for "${value.trim()}"`}
                </span>
                <span className="font-mono">{results.length}</span>
              </>
            ) : (
              <span>Type and hit enter</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto hide-scroll p-2">
            {error && (
              <div className="m-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}
            {!error && !loading && results.length === 0 && value.trim() && lastQuery.current === value.trim() && (
              <p className="text-center text-zinc-500 text-sm py-12 font-light">
                No matches. Try a different phrasing.
              </p>
            )}
            {!error && !value.trim() && (
              <p className="text-center text-zinc-500 text-sm py-12 font-light">
                Tip: add "karaoke" or the artist name for cleaner instrumentals.
              </p>
            )}
            <ul className="flex flex-col">
              {results.map((r) => {
                const queued = queuedIds.has(r.youtube_id);
                const dur = fmtDuration(r.duration_sec ?? null);
                return (
                  <li key={r.youtube_id}>
                    <div className="p-3 rounded-2xl hover:bg-white/[0.04] transition-colors flex items-start gap-3">
                      <div className="w-24 h-16 rounded-lg bg-zinc-800 overflow-hidden relative border border-white/10 flex-shrink-0">
                        {r.thumbnail_url ? (
                          <img src={r.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 grid place-items-center text-zinc-600">
                            <IconYouTube className="w-5 h-5" />
                          </div>
                        )}
                        {dur && (
                          <span className="absolute bottom-1 right-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono border border-white/10 text-zinc-200">
                            {dur}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <h4 className="text-sm font-medium text-zinc-100 line-clamp-2 mb-1">
                          {r.title}
                        </h4>
                        <p className="text-xs text-zinc-500 truncate">
                          {r.channel ?? 'Unknown channel'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => queueResult(r)}
                        disabled={queued}
                        className={`w-10 h-10 rounded-full flex items-center justify-center border transition active:scale-95 flex-shrink-0 ${
                          queued
                            ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                            : 'bg-white/10 hover:bg-white/20 border-white/10 text-white'
                        }`}
                        aria-label={queued ? 'Queued' : 'Add to queue'}
                      >
                        {queued ? <IconCheck className="w-5 h-5" /> : <IconPlus className="w-5 h-5" />}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function VetoBar({ entry, onAfterAction }: { entry: QueueEntry; onAfterAction: () => void }) {
  const [pending, setPending] = useState<null | 'restart' | 'skip'>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function veto(action: 'restart' | 'skip') {
    if (pending) return;
    setPending(action);
    setFeedback(null);
    try {
      const r = await fetch('/api/singer/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, entry_id: entry.id }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFeedback(body?.message ?? 'request failed');
      } else {
        setFeedback(action === 'restart' ? 'Restart requested' : 'Skip requested');
        onAfterAction();
        setTimeout(() => setFeedback(null), 3000);
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 w-full max-w-[calc(100%-2rem)] sm:max-w-md slide-in">
      {feedback && (
        <div className="text-center mb-2 text-[11px] uppercase tracking-[0.18em] font-semibold text-emerald-300">
          {feedback}
        </div>
      )}
      <div className="glass-pill p-1.5 flex items-center gap-1 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)]">
        <button
          type="button"
          onClick={() => veto('skip')}
          disabled={!!pending}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full hover:bg-rose-500/10 text-zinc-200 hover:text-rose-300 transition disabled:opacity-50"
        >
          <IconSkip className="w-4 h-4" />
          <span className="text-sm font-medium tracking-wide">
            {pending === 'skip' ? 'Asking…' : 'Skip mine'}
          </span>
        </button>
        <span className="w-px h-6 bg-white/10" />
        <button
          type="button"
          onClick={() => veto('restart')}
          disabled={!!pending}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full hover:bg-white/10 text-zinc-200 hover:text-white transition disabled:opacity-50"
        >
          <IconRestart className="w-4 h-4" />
          <span className="text-sm font-medium tracking-wide">
            {pending === 'restart' ? 'Asking…' : 'Restart'}
          </span>
        </button>
      </div>
    </div>
  );
}
