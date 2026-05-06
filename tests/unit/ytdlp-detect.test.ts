import { describe, it, expect } from 'vitest';
import { isBotChallenge } from '@/lib/ytdlp/detect';

describe('isBotChallenge', () => {
  it('matches "Sign in to confirm"', () => {
    expect(isBotChallenge('ERROR: [youtube] xyz: Sign in to confirm you’re not a bot')).toBe(true);
  });
  it('matches HTTP 429', () => {
    expect(isBotChallenge('ERROR: HTTP Error 429: Too Many Requests')).toBe(true);
  });
  it('matches "Video unavailable. This content isn\'t available"', () => {
    expect(isBotChallenge("ERROR: [youtube] xyz: Video unavailable. This content isn't available, try again later")).toBe(true);
  });
  it('does not match generic error', () => {
    expect(isBotChallenge('ERROR: ffmpeg not found')).toBe(false);
  });
});
