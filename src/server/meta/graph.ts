import { createHmac } from 'node:crypto';

/**
 * Minimal Graph API client for Instagram API with Unified Login
 * (graph.facebook.com, Business Integration System User access token).
 * Every call is signed with appsecret_proof; tokens travel in the request
 * only (never in logs or errors).
 */
export type MetaConfig = {
  appId: string | undefined;
  appSecret: string | undefined;
  configId: string | undefined;
  redirectUri: string | undefined;
  graphVersion: string;
  fetchImpl?: typeof fetch;
};

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly transient: boolean,
  ) {
    super(message);
  }

  /** The token no longer works (expired, revoked, app removed): reconnect, do not retry. */
  get isAuth(): boolean {
    return this.code === 190 || this.code === 102;
  }

  /** A permission or feature is missing (app review, scope, account type). */
  get isPermission(): boolean {
    return this.code === 10 || this.code === 3 || (this.code !== null && this.code >= 200 && this.code < 300);
  }

  get isRateLimit(): boolean {
    return [4, 17, 32, 341, 613].includes(this.code ?? -1);
  }
}

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 9007]);

export function missingConfig(config: MetaConfig): string[] {
  return [
    !config.appId && 'META_APP_ID',
    !config.appSecret && 'META_APP_SECRET',
    !config.configId && 'META_LOGIN_CONFIG_ID',
    !config.redirectUri && 'META_REDIRECT_URI',
  ].filter((name): name is string => Boolean(name));
}

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

/** Removes anything that looks like a token from text that may reach logs or the UI. */
export function redact(text: string): string {
  return text.replace(/(access_token|input_token|client_secret|code)=[^&\s"]+/gi, '$1=[redacted]').replace(/EAA[A-Za-z0-9]{20,}/g, '[token]');
}

export async function graphRequest<T>(
  config: MetaConfig,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  token?: string,
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path.replace(/^\/+/, '')}`);
  const body = new URLSearchParams();
  const target = method === 'GET' ? url.searchParams : body;
  for (const [key, value] of Object.entries(params)) if (value !== undefined) target.set(key, String(value));
  if (token) {
    target.set('access_token', token);
    if (config.appSecret) target.set('appsecret_proof', appSecretProof(token, config.appSecret));
  }

  let response: Response;
  try {
    response = await (config.fetchImpl ?? fetch)(url, {
      method,
      body: method === 'GET' ? undefined : body,
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
  } catch (error) {
    throw new MetaApiError(`Could not reach Meta: ${redact(error instanceof Error ? error.message : 'network error')}`, 0, null, null, true);
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!response.ok || (data && typeof data === 'object' && 'error' in data)) {
    const error = (data as { error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; error_user_msg?: string } } | null)?.error;
    const code = error?.code ?? null;
    const transient = response.status >= 500 || Boolean(error?.is_transient) || (code !== null && TRANSIENT_CODES.has(code));
    const message = redact(error?.error_user_msg || error?.message || `Meta answered ${response.status}`);
    throw new MetaApiError(message, response.status, code, error?.error_subcode ?? null, transient);
  }
  return data as T;
}
