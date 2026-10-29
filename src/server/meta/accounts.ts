import { and, eq } from 'drizzle-orm';

import { logActivity } from '@/server/activity';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import type { Db } from '@/server/db';
import { instagramAccounts } from '@/server/db/schema';

import { graphRequest, MetaApiError, type MetaConfig } from './graph';

/** Permissions this app uses (Unified Login, instagram_* family). Insights is optional: only Analytics needs it. */
export const REQUIRED_SCOPES = {
  basic: 'instagram_basic',
  publish: 'instagram_content_publish',
  insights: 'instagram_manage_insights',
} as const;

/** Granted permissions this app never uses (e.g. instagram_manage_messages, which Meta's default configuration requires). */
export function unusedScopes(scopes: string[]): string[] {
  const used: string[] = Object.values(REQUIRED_SCOPES);
  return scopes.filter((scope) => !used.includes(scope));
}

/** Why a connection could not be completed; the callback shows a message per code. */
export class ConnectionProblem extends Error {
  constructor(message: string, readonly code: 'invalid_token' | 'unsupported_token' | 'no_account') {
    super(message);
  }
}

/** The stored status, except that a token past its expiry date needs a reconnection even before the next check. */
export function effectiveStatus(account: Pick<typeof instagramAccounts.$inferSelect, 'status' | 'tokenExpiresAt'>, now = new Date()): string {
  return account.status === 'connected' && account.tokenExpiresAt && account.tokenExpiresAt <= now ? 'needs_reauth' : account.status;
}

export type TokenInfo = { isValid: boolean; scopes: string[]; expiresAt: Date | null; type: string | null };

/** What Meta says about a token: valid or not, granted scopes, expiry (0 = never). App access token = APP_ID|APP_SECRET. */
export async function inspectToken(config: MetaConfig, token: string): Promise<TokenInfo> {
  const data = await graphRequest<{ data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number; data_access_expires_at?: number; type?: string } }>(
    config, 'GET', 'debug_token', { input_token: token, access_token: `${config.appId}|${config.appSecret}` },
  );
  const info = data.data ?? {};
  const expires = info.expires_at && info.expires_at > 0 ? new Date(info.expires_at * 1000) : null;
  return { isValid: Boolean(info.is_valid), scopes: info.scopes ?? [], expiresAt: expires, type: info.type ?? null };
}

type IgAccount = { id: string; username: string; name?: string; profile_picture_url?: string };

/**
 * After the code exchange: find the business and the Instagram accounts it
 * shared with the app (/me/assigned_instagram_accounts), then store one row per
 * account with the encrypted token, the client business ID, the configuration
 * ID and the granted scopes.
 */
export async function connectAccounts(db: Db, config: MetaConfig, input: { ownerId: string; token: string; encryptionKey: string | undefined }) {
  const tokenInfo = await inspectToken(config, input.token);
  if (!tokenInfo.isValid) throw new ConnectionProblem('Meta reports the new access token as invalid.', 'invalid_token');
  const business = await graphRequest<{ client_business_id?: string }>(config, 'GET', 'me', { fields: 'client_business_id' }, input.token).catch(() => ({ client_business_id: undefined }));
  // Only a Business Integration System User token has this edge; a user token
  // (configuration with token type "User access token") fails here.
  const assigned = await graphRequest<{ data?: IgAccount[] }>(config, 'GET', 'me/assigned_instagram_accounts', { fields: 'id,username' }, input.token)
    .catch((error: unknown) => {
      if (error instanceof MetaApiError && error.isAuth) throw new ConnectionProblem('Meta refused the new access token.', 'invalid_token');
      if (error instanceof MetaApiError && !error.transient) {
        throw new ConnectionProblem(`Meta did not list the Instagram accounts shared with the app (${error.message}). The login configuration must use the token type "System-user access token".`, 'unsupported_token');
      }
      throw error;
    });
  const accounts = assigned.data ?? [];
  if (!accounts.length) {
    throw new ConnectionProblem('No Instagram professional account was shared with this app. In the login dialog, select the Instagram account (Business or Creator) of your business portfolio.', 'no_account');
  }

  const ciphertext = encryptSecret(input.token, input.encryptionKey);
  const saved = [];
  for (const account of accounts) {
    const profile = await graphRequest<IgAccount>(config, 'GET', account.id, { fields: 'id,username,name,profile_picture_url' }, input.token).catch(() => account);
    const values = {
      ownerId: input.ownerId, igUserId: account.id, username: profile.username ?? account.username, name: profile.name ?? null,
      profilePictureUrl: profile.profile_picture_url ?? null, clientBusinessId: business.client_business_id ?? null, loginConfigId: config.configId ?? null,
      tokenCiphertext: ciphertext, tokenType: tokenInfo.type ?? 'SYSTEM_USER', tokenExpiresAt: tokenInfo.expiresAt, grantedScopes: tokenInfo.scopes,
      status: 'connected', lastCheckedAt: new Date(), lastError: null, updatedAt: new Date(),
    };
    // Reconnecting the same account updates its row (unique on owner and Instagram id).
    await db.insert(instagramAccounts).values(values).onDuplicateKeyUpdate({ set: values });
    const [row] = await db.select().from(instagramAccounts)
      .where(and(eq(instagramAccounts.ownerId, input.ownerId), eq(instagramAccounts.igUserId, account.id)));
    saved.push(row!);
    await logActivity(db, { ownerId: input.ownerId, type: 'account_connected', level: 'success', message: `Instagram account @${row!.username} connected` });
  }
  return saved;
}

export function accountToken(account: typeof instagramAccounts.$inferSelect, encryptionKey: string | undefined): string {
  if (!account.tokenCiphertext) throw new MetaApiError('The account has no stored access: reconnect it.', 401, 190, null, false);
  return decryptSecret(account.tokenCiphertext, encryptionKey);
}

export type Diagnostics = { ok: boolean; problems: string[]; notes: string[]; scopes: string[]; expiresAt: Date | null };

/** Re-checks a connected account: token valid, scopes granted, account reachable. Updates its status. */
export async function checkAccount(db: Db, config: MetaConfig, account: typeof instagramAccounts.$inferSelect, encryptionKey: string | undefined): Promise<Diagnostics> {
  const problems: string[] = [];
  const notes: string[] = [];
  let scopes: string[] = account.grantedScopes;
  let expiresAt: Date | null = account.tokenExpiresAt;
  let status: 'connected' | 'needs_reauth' | 'error' = 'connected';
  try {
    const token = accountToken(account, encryptionKey);
    const info = await inspectToken(config, token);
    scopes = info.scopes;
    expiresAt = info.expiresAt;
    if (!info.isValid) {
      status = 'needs_reauth';
      problems.push('Meta reports the access as invalid (removed from the business portfolio, or expired). Reconnect the account.');
    } else {
      if (!scopes.includes(REQUIRED_SCOPES.basic)) problems.push('Permission instagram_basic is not granted.');
      if (!scopes.includes(REQUIRED_SCOPES.publish)) problems.push('Permission instagram_content_publish is not granted: publishing is unavailable.');
      if (!scopes.includes(REQUIRED_SCOPES.insights)) notes.push('Optional permission instagram_manage_insights is not granted: Analytics stays empty until it is added to the login configuration and the account is reconnected.');
      const unused = unusedScopes(scopes);
      if (unused.length) notes.push(`Granted but not used by this app: ${unused.join(', ')}.`);
      if (expiresAt && expiresAt.getTime() < Date.now() + 7 * 86_400_000) problems.push(`Access expires on ${expiresAt.toISOString().slice(0, 10)}: reconnect before then.`);
      await graphRequest(config, 'GET', account.igUserId, { fields: 'id,username' }, token);
    }
  } catch (error) {
    if (error instanceof MetaApiError && error.isAuth) {
      status = 'needs_reauth';
      problems.push('Access was revoked or expired. Reconnect the account.');
    } else {
      status = 'error';
      problems.push(error instanceof Error ? error.message : 'Unknown error while checking the account.');
    }
  }
  await db.update(instagramAccounts).set({ status, grantedScopes: scopes, tokenExpiresAt: expiresAt, lastCheckedAt: new Date(), lastError: problems[0] ?? null, updatedAt: new Date() })
    .where(eq(instagramAccounts.id, account.id));
  return { ok: status === 'connected' && problems.length === 0, problems, notes, scopes, expiresAt };
}

/**
 * Disconnect here: the stored token is deleted. Meta has no revocation endpoint
 * for system-user tokens: the business removes the app in Business Settings >
 * Integrations > Connected apps to invalidate it on Meta's side.
 */
export async function disconnectAccount(db: Db, ownerId: string, accountId: string) {
  const owned = and(eq(instagramAccounts.id, accountId), eq(instagramAccounts.ownerId, ownerId));
  const [found] = await db.select({ id: instagramAccounts.id }).from(instagramAccounts).where(owned);
  if (!found) return null;
  await db.update(instagramAccounts).set({ tokenCiphertext: null, status: 'disconnected', grantedScopes: [], updatedAt: new Date() }).where(owned);
  const [row] = await db.select().from(instagramAccounts).where(owned);
  if (row) await logActivity(db, { ownerId, type: 'account_disconnected', level: 'warning', message: `Instagram account @${row.username} disconnected` });
  return row ?? null;
}

export async function listAccounts(db: Db, ownerId: string) {
  return db.select().from(instagramAccounts).where(eq(instagramAccounts.ownerId, ownerId));
}
