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
