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
