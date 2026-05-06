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
