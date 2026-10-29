import { and, eq, gt, isNull, lt } from 'drizzle-orm';

import { randomToken, sha256 } from '@/server/crypto';
import type { Db } from '@/server/db';
import { oauthStates } from '@/server/db/schema';

import { graphRequest, missingConfig, type MetaConfig } from './graph';

/**
 * Instagram API with Unified Login: Facebook Login for Business with a
 * configuration whose token type is "System-user access token". The login
 * dialog carries the configuration ID (config_id); Meta redirects back with a
 * code that only the server exchanges, with the Meta app ID and secret. System
 * user tokens support only the authorization-code grant.
 */
const STATE_TTL_MS = 10 * 60_000;

/** The route Meta redirects to (src/app/api/meta/oauth/callback). */
export const CALLBACK_PATH = '/api/meta/oauth/callback';

export class OAuthError extends Error {
  constructor(message: string, readonly code: 'not_configured' | 'invalid_state' | 'denied' | 'exchange_failed' | 'encryption_key' | 'redirect_uri') {
    super(message);
  }
}

/** The redirect URI this deployment must register in Meta: APP_URL + the callback route. */
export function expectedRedirectUri(appUrl: string): string {
  return new URL(CALLBACK_PATH, appUrl).toString();
}

/**
 * Errors make the login fail for certain: Meta would redirect to another route,
 * or to another host where the session cookie is not sent. Warnings are Meta's
 * rules the app cannot check (the Unified login Redirect URL must be HTTPS).
 */
export function redirectUriProblems(appUrl: string, redirectUri: string | undefined): { errors: string[]; warnings: string[] } {
  if (!redirectUri) return { errors: [], warnings: [] };
  const expected = new URL(expectedRedirectUri(appUrl));
  const actual = new URL(redirectUri);
  const errors: string[] = [];
  if (actual.pathname !== CALLBACK_PATH) errors.push(`META_REDIRECT_URI must end with ${CALLBACK_PATH}.`);
  if (actual.host !== expected.host || actual.protocol !== expected.protocol) {
    errors.push(`META_REDIRECT_URI must use the same address as APP_URL (${expected.origin}), otherwise the sign-in cookie is lost on the way back.`);
  }
  const warnings = actual.protocol === 'https:' ? [] : ['Meta requires an HTTPS Redirect URL in the Unified login configuration: use https:// (locally: npm run dev:https).'];
  return { errors, warnings };
}

/** A single-use state bound to the signed-in user (stored as a hash, valid 10 minutes). */
export async function createOAuthState(db: Db, userId: string): Promise<string> {
  const state = randomToken(24);
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values({ userId, stateHash: sha256(state), expiresAt: new Date(Date.now() + STATE_TTL_MS) });
  return state;
}

/** Valid only once, only for the user who started the login, only before it expires. */
export async function consumeOAuthState(db: Db, userId: string, state: string | null): Promise<void> {
  if (!state || state.length > 200) throw new OAuthError('Missing or malformed state parameter.', 'invalid_state');
  const used = await db.update(oauthStates).set({ usedAt: new Date() })
    .where(and(eq(oauthStates.stateHash, sha256(state)), eq(oauthStates.userId, userId), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date())))
    .returning({ id: oauthStates.id });
  if (!used.length) throw new OAuthError('This login link is invalid or expired. Start the connection again.', 'invalid_state');
}

export function authorizeUrl(config: MetaConfig, state: string): string {
  const missing = missingConfig(config);
  if (missing.length) throw new OAuthError(`Meta login is not configured: ${missing.join(', ')}`, 'not_configured');
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', config.appId!);
  url.searchParams.set('redirect_uri', config.redirectUri!);
  url.searchParams.set('config_id', config.configId!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('override_default_response_type', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Server-to-server code exchange. Returns the Business Integration System User access token. */
export async function exchangeCode(config: MetaConfig, code: string): Promise<{ accessToken: string; expiresIn: number | null }> {
  const missing = missingConfig(config);
  if (missing.length) throw new OAuthError(`Meta login is not configured: ${missing.join(', ')}`, 'not_configured');
  try {
    const data = await graphRequest<{ access_token?: string; expires_in?: number }>(config, 'GET', 'oauth/access_token', {
      client_id: config.appId, client_secret: config.appSecret, redirect_uri: config.redirectUri, code,
    });
    if (!data.access_token) throw new OAuthError('Meta returned no access token.', 'exchange_failed');
    return { accessToken: data.access_token, expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null };
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError(`Could not exchange the authorization code: ${error instanceof Error ? error.message : 'unknown error'}`, 'exchange_failed');
  }
}
