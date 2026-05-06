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
