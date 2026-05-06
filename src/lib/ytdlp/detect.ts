const PATTERNS = [
  /Sign in to confirm/i,
  /HTTP Error 429/i,
  /This content isn'?t available, try again later/i,
  /Please sign in/i,
];

export function isBotChallenge(stderr: string): boolean {
  return PATTERNS.some((p) => p.test(stderr));
}
