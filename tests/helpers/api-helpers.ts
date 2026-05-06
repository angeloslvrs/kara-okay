export function makeRequest(url: string, init: RequestInit & { cookies?: Record<string, string> } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookies) {
    const c = Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    headers.set('cookie', c);
  }
  return new Request(`http://localhost${url}`, { ...init, headers });
}

export async function readJson(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}
