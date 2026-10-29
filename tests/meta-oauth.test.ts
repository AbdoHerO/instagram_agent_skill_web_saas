import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret } from '@/server/crypto';
import type { Db } from '@/server/db';
import { instagramAccounts, oauthStates } from '@/server/db/schema';
import { checkAccount, connectAccounts, disconnectAccount } from '@/server/meta/accounts';
import { graphRequest, MetaApiError, redact } from '@/server/meta/graph';
import { authorizeUrl, consumeOAuthState, createOAuthState, exchangeCode, OAuthError } from '@/server/meta/oauth';

import { createTestDb } from './helpers/db';
import { fakeMeta, validToken } from './helpers/fake-meta';
import { createUser } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

const KEY = Buffer.alloc(32, 7).toString('base64');
const TOKEN = 'EAAtestsystemusertoken1234567890abcdef';

describe('Unified Login authorization', () => {
  it('builds the Facebook Login for Business URL with the configuration ID and an exact redirect URI', () => {
    const { config } = fakeMeta({});
    const url = new URL(authorizeUrl(config, 'state-123'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1234567890', redirect_uri: 'https://app.test/api/meta/oauth/callback', config_id: 'cfg-987',
      response_type: 'code', override_default_response_type: 'true', state: 'state-123',
    });
    expect(url.toString()).not.toContain('test-app-secret');
    expect(() => authorizeUrl({ ...config, configId: undefined }, 's')).toThrow(OAuthError);
  });

  it('accepts a state once, only for the user who started the login, only before it expires', async () => {
    const user = await createUser(db);
    const other = await createUser(db);
    const state = await createOAuthState(db, user.id);
    await expect(consumeOAuthState(db, other.id, state)).rejects.toMatchObject({ code: 'invalid_state' });
    await consumeOAuthState(db, user.id, state);
    await expect(consumeOAuthState(db, user.id, state)).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(consumeOAuthState(db, user.id, null)).rejects.toMatchObject({ code: 'invalid_state' });

    const expired = await createOAuthState(db, user.id);
    await db.update(oauthStates).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(consumeOAuthState(db, user.id, expired)).rejects.toMatchObject({ code: 'invalid_state' });
    const [row] = await db.select().from(oauthStates).limit(1);
    expect(row?.stateHash).not.toBe(state); // only the hash is stored
  });

  it('exchanges the code on the server and never leaks the secret or the token in errors', async () => {
    const ok = fakeMeta({ 'GET oauth/access_token': () => ({ body: { access_token: TOKEN, token_type: 'bearer' } }) });
    expect(await exchangeCode(ok.config, 'the-code')).toEqual({ accessToken: TOKEN, expiresIn: null });
    const params = ok.calls[0]!.params;
    expect(params.get('client_secret')).toBe('test-app-secret');
    expect(params.get('redirect_uri')).toBe('https://app.test/api/meta/oauth/callback');
    expect(params.get('code')).toBe('the-code');

    const bad = fakeMeta({ 'GET oauth/access_token': () => ({ status: 400, body: { error: { message: 'Invalid verification code format. code=abc&client_secret=xyz', code: 100 } } }) });
    const error = (await exchangeCode(bad.config, 'abc').catch((e: unknown) => e)) as OAuthError;
    expect(error).toBeInstanceOf(OAuthError);
    expect(error.message).not.toContain('xyz');
    expect(redact(`access_token=${TOKEN}&x=1 ${TOKEN}`)).not.toContain(TOKEN);
  });
});

describe('connected accounts', () => {
  it('stores each shared Instagram account with the encrypted token, business ID and granted scopes', async () => {
    const owner = await createUser(db);
    const meta = fakeMeta({
      'GET debug_token': validToken(),
      'GET me': () => ({ body: { client_business_id: 'biz-42', id: 'app-scoped' } }),
      'GET me/assigned_instagram_accounts': () => ({ body: { data: [{ id: '17841400000000001', username: 'eurodigital.ma' }] } }),
      'GET 17841400000000001': () => ({ body: { id: '17841400000000001', username: 'eurodigital.ma', name: 'Euro Digital' } }),
    });
    const [account] = await connectAccounts(db, meta.config, { ownerId: owner.id, token: TOKEN, encryptionKey: KEY });
    expect(account!).toMatchObject({ igUserId: '17841400000000001', username: 'eurodigital.ma', clientBusinessId: 'biz-42', loginConfigId: 'cfg-987', status: 'connected' });
    expect(account!.grantedScopes).toContain('instagram_content_publish');
    expect(account!.tokenCiphertext).not.toContain(TOKEN);
    expect(decryptSecret(account!.tokenCiphertext!, KEY)).toBe(TOKEN);
    // Every token-bearing call is signed with appsecret_proof.
    for (const call of meta.calls.filter((c) => c.params.has('access_token') && c.path !== 'debug_token')) expect(call.params.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);

    const none = fakeMeta({ 'GET debug_token': validToken(), 'GET me': () => ({ body: {} }), 'GET me/assigned_instagram_accounts': () => ({ body: { data: [] } }) });
    await expect(connectAccounts(db, none.config, { ownerId: owner.id, token: TOKEN, encryptionKey: KEY })).rejects.toThrow(/No Instagram professional account/);
  });

  it('detects revoked access and missing permissions, and disconnects by deleting the token', async () => {
    const owner = await createUser(db);
    const meta = fakeMeta({
      'GET debug_token': validToken(),
      'GET me': () => ({ body: { client_business_id: 'biz-1' } }),
      'GET me/assigned_instagram_accounts': () => ({ body: { data: [{ id: '178414', username: 'shop' }] } }),
      'GET 178414': () => ({ body: { id: '178414', username: 'shop' } }),
    });
    const [account] = await connectAccounts(db, meta.config, { ownerId: owner.id, token: TOKEN, encryptionKey: KEY });

    const noPublish = fakeMeta({ 'GET debug_token': validToken(['instagram_basic']), 'GET 178414': () => ({ body: { id: '178414' } }) });
    const partial = await checkAccount(db, noPublish.config, account!, KEY);
    expect(partial.problems.join(' ')).toMatch(/instagram_content_publish/);

    const revoked = fakeMeta({ 'GET debug_token': () => ({ status: 400, body: { error: { message: 'Error validating access token', code: 190 } } }) });
    const check = await checkAccount(db, revoked.config, account!, KEY);
    expect(check.ok).toBe(false);
    const [after] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, account!.id));
    expect(after!.status).toBe('needs_reauth');

    const stranger = await createUser(db);
    expect(await disconnectAccount(db, stranger.id, account!.id)).toBeNull();
    const gone = await disconnectAccount(db, owner.id, account!.id);
    expect(gone).toMatchObject({ status: 'disconnected', tokenCiphertext: null });
  });

  it('classifies Graph errors: auth, permission, rate limit, transient', async () => {
    const meta = fakeMeta({
      'GET a': () => ({ status: 400, body: { error: { message: 'expired', code: 190 } } }),
      'GET b': () => ({ status: 403, body: { error: { message: 'no permission', code: 10 } } }),
      'GET c': () => ({ status: 400, body: { error: { message: 'slow down', code: 4, is_transient: true } } }),
      'GET d': () => ({ status: 503, body: 'unavailable' }),
    });
    const errorOf = async (path: string) => (await graphRequest(meta.config, 'GET', path, {}, TOKEN).catch((e: unknown) => e)) as MetaApiError;
    expect((await errorOf('a')).isAuth).toBe(true);
    expect((await errorOf('b')).isPermission).toBe(true);
    expect((await errorOf('c'))).toMatchObject({ transient: true });
    expect((await errorOf('d'))).toMatchObject({ transient: true, status: 503 });
  });
});
