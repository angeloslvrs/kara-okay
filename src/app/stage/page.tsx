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
