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
