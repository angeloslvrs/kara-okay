'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconCheck,
  IconCollapse,
  IconExpand,
  IconFullscreen,
  IconFullscreenExit,
  IconMic,
  IconMonitor,
  IconPause,
  IconPlay,
  IconRestart,
  IconSkip,
  IconUser,
  IconUsers,
  IconX,
} from '../components/icons';

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

type QueueState = { entries: QueueEntry[]; current: QueueEntry | null; mode: 'fifo' | 'round_robin' };

type PendingVeto = { id: string; action: 'restart' | 'skip'; singer_id: string; entry_id: string };

const VETO_AUTO_SECONDS = 5;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '·';

const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
};

export default function StagePage() {
  const [tabId] = useState(() => crypto.randomUUID());
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [pendingVeto, setPendingVeto] = useState<PendingVeto | null>(null);
  const [vetoCountdown, setVetoCountdown] = useState(VETO_AUTO_SECONDS);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  const [started, setStarted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/queue').then((res) => res.json()).catch(() => null);
    if (r && !r.error) setQueue(r);
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // SSE + heartbeat once claimed; resilient to dev HMR / network blips.
  useEffect(() => {
    if (!claimed) return;
    refreshRef.current();
    const hb = setInterval(() => {
      fetch('/api/stage/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tab_id: tabId }),
      }).catch(() => {});
    }, 10_000);

    let es: EventSource | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (cancelled) return;
      es = new EventSource('/api/queue/stream');
      es.addEventListener('queue.updated', () => refreshRef.current());
      es.addEventListener('veto.pending', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          setPendingVeto(data?.veto ?? null);
          setVetoCountdown(VETO_AUTO_SECONDS);
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('veto.approved', (e: MessageEvent) => {
        setPendingVeto(null);
        try {
          const d = JSON.parse(e.data);
          if (d.action === 'restart' && videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
          }
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('veto.denied', () => setPendingVeto(null));
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
      clearInterval(hb);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [claimed, tabId]);

  // Veto countdown
  useEffect(() => {
    if (!pendingVeto) return;
    const t = setInterval(() => {
      setVetoCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [pendingVeto]);

  // Auto-start playback for the next entry. We accept `downloading` or
  // `queued` as well so the very first song can stream from YouTube while
  // the local cache file is still being written. Subsequent songs will
  // typically be `ready` by the time their turn comes up.
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

  const claim = useCallback(
    async (force: boolean) => {
      setClaiming(true);
      setClaimError(null);
      try {
        const r = await fetch('/api/stage/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tab_id: tabId, force }),
        });
        if (r.ok) {
          setClaimed(true);
        } else {
          const body = await r.json().catch(() => ({}));
          setClaimError(
            body?.code === 'conflict'
              ? 'Another stage is already claimed. Force-claim to take over.'
              : body?.message ?? 'Could not claim the stage.',
          );
        }
      } finally {
        setClaiming(false);
      }
    },
    [tabId],
  );

  if (!claimed) {
    return (
      <ClaimScreen
        onClaim={() => claim(false)}
        onForce={() => claim(true)}
        claiming={claiming}
        error={claimError}
      />
    );
  }

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
}

function useIdleReveal(active: boolean, idleMs = 2500) {
  const [revealed, setRevealed] = useState(true);
  useEffect(() => {
    if (!active) {
      setRevealed(true);
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    const reset = () => {
      setRevealed(true);
      clearTimeout(t);
      t = setTimeout(() => setRevealed(false), idleMs);
    };
    reset();
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('touchstart', reset);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('touchstart', reset);
    };
  }, [active, idleMs]);
  return revealed;
}

/* -------------------------------------------------------------------------- */

function ClaimScreen({
  onClaim,
  onForce,
  claiming,
  error,
}: {
  onClaim: () => void;
  onForce: () => void;
  claiming: boolean;
  error: string | null;
}) {
  return (
    <main className="relative z-10 min-h-dvh flex items-center justify-center px-6">
      <div className="glass-panel w-full max-w-lg rounded-3xl p-10 slide-in">
        <div className="flex items-center gap-2 text-amber-300/80 text-[11px] uppercase tracking-[0.22em] font-semibold mb-6">
          <IconMonitor className="w-4 h-4" />
          Stage display
        </div>
        <h1 className="text-4xl font-medium tracking-tight text-gradient-soft leading-tight mb-3">
          Claim this screen as the stage.
        </h1>
        <p className="text-sm text-zinc-400 font-light mb-8 leading-relaxed">
          Only one stage tab plays at a time. Claim from the device wired to the TV
          or projector. Phones in the room queue songs and watch.
        </p>
        {error && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
            {error}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onClaim}
            disabled={claiming}
            className="glass-button rounded-2xl px-5 py-3.5 text-sm font-medium tracking-wide text-white flex-1 disabled:opacity-40"
          >
            {claiming ? 'Claiming…' : 'Claim stage'}
          </button>
          <button
            type="button"
            onClick={onForce}
            disabled={claiming}
            className="rounded-2xl px-5 py-3.5 text-sm font-medium tracking-wide text-rose-200 hover:bg-rose-500/10 hover:text-rose-100 transition border border-rose-500/20 flex-1 disabled:opacity-40"
          >
            Force claim
          </button>
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

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
  const current = queue?.current ?? null;
  const upNext = useMemo(
    () => (queue?.entries ?? []).filter((e) => e.id !== current?.id),
    [queue, current],
  );

  const stageAction = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      await fetch('/api/stage/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      }).catch(() => {});
    },
    [],
  );

  const decideVeto = useCallback(async (decision: 'allow' | 'deny') => {
    if (!pendingVeto) return;
    await fetch(`/api/veto/${pendingVeto.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    }).catch(() => {});
  }, [pendingVeto]);

  const [immersive, setImmersive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const reveal = useIdleReveal(immersive);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await (rootRef.current ?? document.documentElement).requestFullscreen();
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setImmersive((v) => !v);
      } else if (e.key === 'Escape') {
        setImmersive(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  return (
    <main
      ref={rootRef}
      className={`relative z-10 w-full h-dvh flex transition-[padding,gap] duration-500 ${
        immersive ? 'p-0 gap-0 flex-row' : 'flex-col lg:flex-row p-4 lg:p-8 xl:p-10 gap-5 lg:gap-7'
      }`}
    >
      {/* Stage / video hero */}
      <section className="flex-1 flex flex-col justify-center relative min-w-0">
        <div
          className={`absolute z-20 flex items-center gap-3 transition-opacity duration-500 ${
            immersive ? `top-5 left-5 ${reveal ? 'opacity-100' : 'opacity-0'}` : 'top-0 left-0 opacity-100'
          }`}
        >
          <div className="glass-subtle px-4 py-2 rounded-full flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium tracking-[0.22em] text-zinc-300 uppercase">
              Stage live
            </span>
          </div>
          {!immersive && (
            <span className="hidden lg:inline text-zinc-500 text-xs tracking-wide font-light font-mono">
              {tabId.slice(0, 8)}
            </span>
          )}
        </div>

        <StageActions
          immersive={immersive}
          fullscreen={isFullscreen}
          revealed={!immersive || reveal}
          onToggleImmersive={() => setImmersive((v) => !v)}
          onToggleFullscreen={toggleFullscreen}
        />

        <div
          className={`w-full glass-panel relative overflow-hidden transition-[border-radius,box-shadow,aspect-ratio] duration-500 ${
            immersive
              ? 'rounded-none shadow-none aspect-auto h-dvh'
              : 'rounded-[2rem] shadow-[0_0_80px_rgba(0,0,0,0.7)] aspect-video'
          }`}
        >
          {current ? (
            <video
              ref={videoRef}
              key={current.id}
              src={`/api/cache/${current.id}?fallback=1`}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-contain bg-black"
              onPlay={() => onPausedChange(false)}
              onPause={() => onPausedChange(true)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                onProgress({ current: v.currentTime, duration: v.duration || 0 });
              }}
              onLoadedMetadata={(e) => {
                onProgress({ current: 0, duration: e.currentTarget.duration || 0 });
              }}
              onEnded={() => {
                stageAction('finish');
                onRefresh();
              }}
            />
          ) : (
            <IdleStageBackdrop nextTitle={upNext[0]?.title ?? null} />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-obsidian/95 via-obsidian/30 to-transparent pointer-events-none" />

          {/* Now performing overlay */}
          {current && (
            <div
              className={`absolute z-10 transition-[inset] duration-500 ${
                immersive
                  ? 'inset-x-10 lg:inset-x-16 bottom-24 lg:bottom-28'
                  : 'inset-x-6 lg:inset-x-10 bottom-6 lg:bottom-10'
              }`}
            >
              <div className="flex items-end gap-5 mb-3">
                <div className="w-14 h-14 rounded-full glass-panel flex items-center justify-center text-base font-medium relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/40 to-purple-500/30" />
                  <span className="relative">{initials(current.singer.display_name)}</span>
                </div>
                <div className="flex flex-col pb-1 min-w-0">
                  <span className="text-[11px] text-indigo-300/90 font-medium tracking-[0.22em] uppercase mb-1.5">
                    Currently performing
                  </span>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl lg:text-3xl font-light text-white tracking-wide truncate">
                      {current.singer.display_name}
                    </h2>
                    <div className="hidden lg:flex items-end gap-1 h-4 text-indigo-400">
                      <span className="eq-bar h-2.5" style={{ animationDelay: '0.1s', animationDuration: '1.1s' }} />
                      <span className="eq-bar h-4" style={{ animationDelay: '0.3s', animationDuration: '0.7s' }} />
                      <span className="eq-bar h-3" style={{ animationDelay: '0.2s', animationDuration: '1.3s' }} />
                      <span className="eq-bar h-3.5" style={{ animationDelay: '0.5s', animationDuration: '0.9s' }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative">
                <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-[6rem] font-semibold tracking-tighter leading-none text-stroke-soft absolute top-1 left-1 select-none pointer-events-none opacity-50">
                  {current.title}
                </h1>
                <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-[6rem] font-semibold tracking-tighter leading-none text-white text-glow relative">
                  {current.title}
                </h1>
              </div>
              {current.channel && (
                <div className="text-base lg:text-lg xl:text-xl text-zinc-400 font-light tracking-wide mt-2 truncate">
                  {current.channel}
                </div>
              )}

              <ProgressTrack progress={progress} paused={paused} />
            </div>
          )}

          {/* Veto pending toast */}
          {pendingVeto && (
            <VetoToast
              veto={pendingVeto}
              countdown={vetoCountdown}
              onDecide={decideVeto}
            />
          )}
        </div>
      </section>

      {/* Side rail */}
      <aside
        className={`flex flex-col gap-5 flex-shrink-0 z-20 max-h-full transition-all duration-500 overflow-hidden ${
          immersive
            ? 'w-0 opacity-0 pointer-events-none'
            : 'w-full lg:w-[340px] xl:w-[400px] opacity-100'
        }`}
        aria-hidden={immersive}
      >
        <UpNextRail entries={upNext} currentMode={queue?.mode ?? 'fifo'} />
        <OperatorPanel
          paused={paused}
          hasCurrent={!!current}
          videoRef={videoRef}
          onAction={stageAction}
          onRefresh={onRefresh}
        />
      </aside>

      {immersive && (
        <FloatingOperatorBar
          revealed={reveal}
          paused={paused}
          hasCurrent={!!current}
          videoRef={videoRef}
          onAction={stageAction}
          onRefresh={onRefresh}
        />
      )}

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
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function StageActions({
  immersive,
  fullscreen,
  revealed,
  onToggleImmersive,
  onToggleFullscreen,
}: {
  immersive: boolean;
  fullscreen: boolean;
  revealed: boolean;
  onToggleImmersive: () => void;
  onToggleFullscreen: () => void;
}) {
  return (
    <div
      className={`absolute z-20 flex items-center gap-2 transition-opacity duration-500 ${
        immersive ? `top-5 right-5 ${revealed ? 'opacity-100' : 'opacity-0'}` : 'top-0 right-0 opacity-100'
      }`}
    >
      <button
        type="button"
        onClick={onToggleImmersive}
        className="glass-pill h-10 px-3 flex items-center gap-2 text-zinc-300 hover:text-white text-xs font-medium tracking-[0.18em] uppercase"
        title={immersive ? 'Exit immersive (I or Esc)' : 'Immersive mode (I)'}
      >
        {immersive ? <IconCollapse className="w-4 h-4" /> : <IconExpand className="w-4 h-4" />}
        <span className="hidden sm:inline">{immersive ? 'Exit' : 'Immersive'}</span>
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        className="glass-pill h-10 w-10 grid place-items-center text-zinc-300 hover:text-white"
        title={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {fullscreen ? <IconFullscreenExit className="w-4 h-4" /> : <IconFullscreen className="w-4 h-4" />}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function FloatingOperatorBar({
  revealed,
  paused,
  hasCurrent,
  videoRef,
  onAction,
  onRefresh,
}: {
  revealed: boolean;
  paused: boolean;
  hasCurrent: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onAction: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  onRefresh: () => void;
}) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-30 transition-opacity duration-500 ${
        revealed ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="glass-pill p-1.5 flex items-center gap-1 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)]">
        <button
          type="button"
          disabled={!hasCurrent}
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
              videoRef.current.play().catch(() => {});
            }
            onAction('restart');
          }}
          className="w-11 h-11 rounded-full hover:bg-white/10 text-zinc-300 hover:text-white grid place-items-center disabled:opacity-30"
          title="Restart"
          aria-label="Restart"
        >
          <IconRestart className="w-4 h-4" />
        </button>
        <button
          type="button"
          disabled={!hasCurrent}
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) {
              v.play().catch(() => {});
              onAction('resume');
            } else {
              v.pause();
              onAction('pause');
            }
          }}
          className="w-12 h-12 rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white grid place-items-center disabled:opacity-30"
          title={paused ? 'Play' : 'Pause'}
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? <IconPlay className="w-5 h-5" /> : <IconPause className="w-4 h-4" />}
        </button>
        <button
          type="button"
          disabled={!hasCurrent}
          onClick={async () => {
            await onAction('skip');
            onRefresh();
          }}
          className="w-11 h-11 rounded-full hover:bg-white/10 text-zinc-300 hover:text-white grid place-items-center disabled:opacity-30"
          title="Skip"
          aria-label="Skip"
        >
          <IconSkip className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function IdleStageBackdrop({ nextTitle }: { nextTitle: string | null }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
      <div className="text-[11px] uppercase tracking-[0.28em] text-zinc-500 font-semibold mb-4">
        Stage is open
      </div>
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tight text-gradient-soft mb-3">
        Waiting for a song…
      </h1>
      {nextTitle ? (
        <p className="text-zinc-400 font-light max-w-md">
          Next up: <span className="text-zinc-200">{nextTitle}</span>
        </p>
      ) : (
        <p className="text-zinc-500 font-light max-w-md">
          Anyone in the room can queue a song from their phone.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ProgressTrack({
  progress,
  paused,
}: {
  progress: { current: number; duration: number };
  paused: boolean;
}) {
  const pct = progress.duration > 0
    ? Math.min(100, (progress.current / progress.duration) * 100)
    : 0;
  return (
    <div className="w-full mt-6 lg:mt-8">
      <div className="h-[2px] bg-white/10 rounded-full overflow-hidden relative">
        <div
          className="absolute inset-y-0 left-0 bg-white rounded-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${pct}%`,
            boxShadow: '0 0 12px rgba(255,255,255,0.7)',
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-2 tracking-widest">
        <span>{fmtTime(progress.current)}</span>
        <span>{paused ? 'PAUSED' : ''}</span>
        <span>{fmtTime(progress.duration)}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function UpNextRail({
  entries,
  currentMode,
}: {
  entries: QueueEntry[];
  currentMode: 'fifo' | 'round_robin';
}) {
  return (
    <div className="flex-1 glass-panel rounded-[1.75rem] p-5 lg:p-6 flex flex-col overflow-hidden relative min-h-0">
      <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
        <h3 className="text-xs font-semibold tracking-[0.25em] text-white/70 uppercase">
          Up next
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
            {currentMode === 'round_robin' ? 'Round robin' : 'FIFO'}
          </span>
          <span className="text-[11px] bg-white/5 text-white/60 px-2 py-0.5 rounded-md tracking-wider">
            {entries.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto hide-scroll pr-1 space-y-2">
        {entries.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm font-light py-10">
            <IconUsers className="w-6 h-6 mx-auto mb-3 text-zinc-600" />
            Queue's empty.
            <br />
            Phones in the room can add songs.
          </div>
        ) : (
          entries.map((e, i) => {
            const opacity = i === 0 ? 'opacity-100' : i === 1 ? 'opacity-85' : i === 2 ? 'opacity-65' : 'opacity-50';
            return (
              <div
                key={e.id}
                className={`group p-3 rounded-xl hover:bg-white/[0.04] transition-colors ${opacity} hover:opacity-100`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 border border-white/10 text-xs font-medium">
                    {initials(e.singer.display_name)}
                  </div>
                  <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                    <span className="text-xs text-zinc-400 font-light truncate">
                      {e.singer.display_name}
                    </span>
                    <span className="text-[15px] font-medium text-white truncate leading-tight">
                      {e.title}
                    </span>
                    {e.channel && (
                      <span className="text-xs text-zinc-500 font-light truncate mt-0.5">
                        {e.channel}
                      </span>
                    )}
                  </div>
                  {e.status === 'downloading' && (
                    <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300/90 font-semibold mt-1 shrink-0">
                      Buffering
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/30 to-transparent pointer-events-none rounded-b-[1.75rem]" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function OperatorPanel({
  paused,
  hasCurrent,
  videoRef,
  onAction,
  onRefresh,
}: {
  paused: boolean;
  hasCurrent: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onAction: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  onRefresh: () => void;
}) {
  return (
    <div className="glass-panel rounded-[1.5rem] p-4 flex items-center justify-between opacity-50 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-500 group">
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-[0.22em] font-semibold mb-0.5">
          Operator
        </span>
        <span className="text-sm text-zinc-300 font-light">Stage control</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!hasCurrent}
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
              videoRef.current.play().catch(() => {});
            }
            onAction('restart');
          }}
          className="w-10 h-10 rounded-full hover:bg-white/10 transition-colors text-zinc-400 hover:text-white grid place-items-center disabled:opacity-30"
          title="Restart"
          aria-label="Restart current track"
        >
          <IconRestart className="w-4 h-4" />
        </button>
        <button
          type="button"
          disabled={!hasCurrent}
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) {
              v.play().catch(() => {});
              onAction('resume');
            } else {
              v.pause();
              onAction('pause');
            }
          }}
          className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/15 transition-all transform group-hover:scale-105 active:scale-95 text-white shadow-[0_0_20px_rgba(255,255,255,0.06)] disabled:opacity-30"
          title={paused ? 'Play' : 'Pause'}
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? <IconPlay className="w-5 h-5" /> : <IconPause className="w-4 h-4" />}
        </button>
        <button
          type="button"
          disabled={!hasCurrent}
          onClick={async () => {
            await onAction('skip');
            onRefresh();
          }}
          className="w-10 h-10 rounded-full hover:bg-white/10 transition-colors text-zinc-400 hover:text-white grid place-items-center disabled:opacity-30"
          title="Skip"
          aria-label="Skip current track"
        >
          <IconSkip className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function VetoToast({
  veto,
  countdown,
  onDecide,
}: {
  veto: PendingVeto;
  countdown: number;
  onDecide: (decision: 'allow' | 'deny') => void;
}) {
  const radius = 18;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - countdown / VETO_AUTO_SECONDS);

  const verb = veto.action === 'restart' ? 'restart' : 'skip';

  return (
    <div className="absolute top-6 right-6 lg:top-8 lg:right-8 glass-panel rounded-2xl px-5 py-4 flex items-center gap-4 border border-rose-500/30 z-30 slide-in shadow-2xl max-w-sm">
      <div className="relative">
        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
          <circle
            cx="22"
            cy="22"
            r={radius}
            stroke="currentColor"
            strokeWidth="2"
            fill="transparent"
            className="text-white/10"
          />
          <circle
            cx="22"
            cy="22"
            r={radius}
            stroke="currentColor"
            strokeWidth="2"
            fill="transparent"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="text-rose-400 transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-rose-300 text-xs font-mono">
          {countdown}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.22em] text-rose-300 font-semibold">
          Veto pending
        </div>
        <div className="text-sm text-white font-light mt-0.5">
          Singer wants to <span className="font-medium">{verb}</span>. Auto-allow in {countdown}s.
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onDecide('deny')}
          className="w-9 h-9 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-300 hover:text-white grid place-items-center"
          title="Deny"
          aria-label="Deny veto"
        >
          <IconX className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onDecide('allow')}
          className="w-9 h-9 rounded-full bg-rose-500/20 border border-rose-400/30 hover:bg-rose-500/30 text-rose-200 grid place-items-center"
          title="Allow"
          aria-label="Allow veto"
        >
          <IconCheck className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
