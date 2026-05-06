import { getDb } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/api/respond';
import { getSettings, updateSettings } from '@/lib/settings';
import { getBus } from '@/lib/sse';

export async function GET(): Promise<Response> {
  return jsonOk(getSettings(getDb()));
}

export async function PUT(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad_request', 'invalid JSON', 400); }
  try {
    const settings = updateSettings(getDb(), body);
    getBus().broadcast('settings.updated', settings);
    return jsonOk({ settings });
  } catch (err) {
    return jsonError('bad_request', (err as Error).message, 400);
  }
}
