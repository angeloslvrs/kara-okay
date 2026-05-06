import { describe, it, expect } from 'vitest';
import { normalizeQuery } from '@/lib/search-query';

describe('normalizeQuery', () => {
  it('appends "karaoke" when missing', () => {
    expect(normalizeQuery('Bohemian Rhapsody')).toBe('Bohemian Rhapsody karaoke');
  });

  it('does not append when already present (lowercase)', () => {
    expect(normalizeQuery('bohemian rhapsody karaoke')).toBe('bohemian rhapsody karaoke');
  });

  it('does not append when already present (uppercase)', () => {
    expect(normalizeQuery('Bohemian Rhapsody KARAOKE')).toBe('Bohemian Rhapsody KARAOKE');
  });

  it('does not append when "Karaoke" appears mid-string', () => {
    expect(normalizeQuery('Karaoke Version of Wonderwall')).toBe('Karaoke Version of Wonderwall');
  });

  it('does not match substrings ("karaokey" should still get karaoke appended)', () => {
    expect(normalizeQuery('karaokey')).toBe('karaokey karaoke');
  });

  it('trims whitespace', () => {
    expect(normalizeQuery('  hello world  ')).toBe('hello world karaoke');
  });

  it('handles empty string', () => {
    expect(normalizeQuery('')).toBe('karaoke');
  });
});
