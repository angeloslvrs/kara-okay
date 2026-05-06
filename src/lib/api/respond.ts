export function jsonOk(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined ?? {}) },
  });
}

export function jsonError(code: string, message: string, status = 400, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined ?? {}) },
  });
}
