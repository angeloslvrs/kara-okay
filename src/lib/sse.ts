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
