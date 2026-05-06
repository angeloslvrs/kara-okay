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
