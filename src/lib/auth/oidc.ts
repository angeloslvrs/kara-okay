import type { DB } from '../db';
import type { Singer } from '../singers';

export async function tryGetMemberFromOidc(_db: DB, _cookies: unknown): Promise<Singer | null> {
  if (!process.env.OIDC_ISSUER) return null;
  // Real OIDC integration is deferred; stub returns null until wired.
  return null;
}
