export type YtSearchResult = {
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
};

export interface YtDlp {
  search(query: string, limit?: number): Promise<YtSearchResult[]>;
  resolve(youtubeId: string): Promise<string>; // signed url
  download(youtubeId: string, destPath: string): Promise<void>;
}

export class BotChallengeError extends Error {
  constructor(message = 'YouTube bot challenge') { super(message); this.name = 'BotChallengeError'; }
}
