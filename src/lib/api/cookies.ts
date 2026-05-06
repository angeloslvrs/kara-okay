import { parse, serialize } from 'cookie';

export function cookiesFromRequest(req: Request): Map<string, string> {
  const header = req.headers.get('cookie') ?? '';
  const obj = parse(header);
  return new Map(Object.entries(obj).filter(([, v]) => v !== undefined) as [string, string][]);
}

export function setCookieHeader(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean } = {}): string {
  return serialize(name, value, {
    path: '/',
    httpOnly: opts.httpOnly ?? true,
    sameSite: 'lax',
    maxAge: opts.maxAge,
  });
}
