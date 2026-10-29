import type { MetaConfig } from '@/server/meta/graph';

/**
 * A scripted stand-in for graph.facebook.com (and the media host). Routes are
 * "METHOD path" -> handler; every call is recorded so tests can assert what was
 * (or was not) sent. Nothing leaves the machine.
 */
export type Call = { method: string; path: string; params: URLSearchParams };
type Handler = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> };

export function fakeMeta(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const queues = new Map<string, Handler[]>();
  for (const [key, value] of Object.entries(routes)) queues.set(key, Array.isArray(value) ? [...value] : [value]);

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.hostname === 'graph.facebook.com' ? url.pathname.replace(/^\/v\d+\.\d+\//, '') : `${url.hostname}${url.pathname}`;
    const params = method === 'GET' ? url.searchParams : new URLSearchParams(String(init?.body ?? ''));
    const call = { method, path, params };
    calls.push(call);
    const key = `${method} ${path}`;
    const queue = queues.get(key);
    const handler = queue && queue.length > 1 ? queue.shift()! : queue?.[0];
    if (!handler) return new Response(JSON.stringify({ error: { message: `No fake route for ${key}`, code: 100 } }), { status: 400 });
    const { status = 200, body = {}, headers = { 'content-type': 'application/json' } } = handler(call);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  }) as typeof fetch;

  const config: MetaConfig = {
    appId: '1234567890', appSecret: 'test-app-secret', configId: 'cfg-987', redirectUri: 'https://app.test/api/meta/oauth/callback',
    graphVersion: 'v26.0', fetchImpl,
  };
  return { config, fetchImpl, calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key).length };
}

export const validToken = (scopes = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights']) =>
  () => ({ body: { data: { is_valid: true, scopes, expires_at: 0, type: 'SYSTEM_USER' } } });
