const KARAOKE_RE = /\bkaraoke\b/i;

export function normalizeQuery(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return 'karaoke';
  if (KARAOKE_RE.test(trimmed)) return trimmed;
  return `${trimmed} karaoke`;
}
