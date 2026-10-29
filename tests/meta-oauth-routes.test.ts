import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as callback } from '@/app/api/meta/oauth/callback/route';
import { GET as start } from '@/app/api/meta/oauth/start/route';
import { decryptSecret, sha256 } from '@/server/crypto';
import type { Db } from '@/server/db';
import { instagramAccounts, oauthStates } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import type { MetaConfig } from '@/server/meta/graph';
import { createOAuthState } from '@/server/meta/oauth';

import { createTestDb } from './helpers/db';
import { fakeMeta, validToken } from './helpers/fake-meta';
import { createUser } from './helpers/fixtures';

/**
 * The OAuth routes end to end: signed-in user, real migrations (PGlite), and a
 * scripted graph.facebook.com. Nothing is sent to Meta.
 */
const current = vi.hoisted(() => ({ user: null as { id: string } | null, db: null as unknown, meta: null as unknown }));
vi.mock('@/server/auth/session', () => ({ currentUser: async () => current.user }));
vi.mock('@/server/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/db')>()), getDb: () => current.db }));
vi.mock('@/server/app', () => ({ metaConfig: () => current.meta }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  current.db = db;
});
afterAll(async () => close());

const KEY = Buffer.alloc(32, 9).toString('base64');
const TOKEN = 'EAAroutetestsystemusertoken0123456789';
const CODE = 'AQD-route-test-code';
const ENV = { APP_URL: 'https://app.test', META_REDIRECT_URI: 'https://app.test/api/meta/oauth/callback', TOKEN_ENCRYPTION_KEY: KEY };
const saved = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));

function setEnv(values: Partial<typeof ENV>) {
  for (const [key, value] of Object.entries({ ...ENV, ...values })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

const connected = () => ({
  'GET oauth/access_token': () => ({ body: { access_token: TOKEN, token_type: 'bearer' } }),
  'GET debug_token': validToken(['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_messages']),
  'GET me': () => ({ body: { client_business_id: 'biz-route' } }),
  'GET me/assigned_instagram_accounts': () => ({ body: { data: [{ id: '17841400000000777', username: 'eurodigital.ma' }] } }),
  'GET 17841400000000777': () => ({ body: { id: '17841400000000777', username: 'eurodigital.ma', name: 'Euro Digital' } }),
});

const location = (response: Response) => response.headers.get('location') ?? '';
const callbackRequest = (query: string) => new NextRequest(`https://app.test/api/meta/oauth/callback?${query}`);
const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(async () => {
  setEnv({});
  current.user = await createUser(db);
  current.meta = fakeMeta({}).config;
  logged.mockClear();
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
});

describe('GET /api/meta/oauth/start', () => {
  it('sends a signed-in user to Meta with the configuration ID and a single-use state', async () => {
    const response = await start();
    const url = new URL(location(response));
    expect(response.status).toBe(307);
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
    expect(url.searchParams.get('config_id')).toBe('cfg-987');
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.META_REDIRECT_URI);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('override_default_response_type')).toBe('true');
    expect(url.searchParams.has('scope')).toBe(false); // the configuration decides the permissions
    const state = url.searchParams.get('state')!;
    const [row] = await db.select().from(oauthStates).where(eq(oauthStates.stateHash, sha256(state)));
    expect(row).toMatchObject({ userId: current.user!.id, usedAt: null });
    expect(location(response)).not.toContain('test-app-secret');
  });

  it('refuses before Meta when the connection could not be completed', async () => {
    current.user = null;
    expect(location(await start())).toBe('https://app.test/login');

    current.user = await createUser(db);
    current.meta = { ...fakeMeta({}).config, configId: undefined } satisfies MetaConfig;
    expect(location(await start())).toBe('https://app.test/accounts?error=not_configured');

    current.meta = fakeMeta({}).config;
    setEnv({ TOKEN_ENCRYPTION_KEY: undefined });
    expect(location(await start())).toBe('https://app.test/accounts?error=encryption_key');

    setEnv({ META_REDIRECT_URI: 'https://elsewhere.test/api/meta/oauth/callback' });
    expect(location(await start())).toBe('https://app.test/accounts?error=redirect_uri');
  });
});

describe('GET /api/meta/oauth/callback', () => {
  it('exchanges the code, stores the encrypted token and the account, and never exposes the code or token', async () => {
    const meta = fakeMeta(connected());
    current.meta = meta.config;
    const state = await createOAuthState(db, current.user!.id);
    const response = await callback(callbackRequest(`code=${CODE}&state=${state}`));
    expect(location(response)).toBe('https://app.test/accounts?connected=1');
    expect(meta.calls[0]).toMatchObject({ path: 'oauth/access_token' });
    expect(meta.calls[0]!.params.get('code')).toBe(CODE);

    const [account] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.ownerId, current.user!.id));
    expect(account).toMatchObject({ igUserId: '17841400000000777', clientBusinessId: 'biz-route', loginConfigId: 'cfg-987', status: 'connected' });
    expect(decryptSecret(account!.tokenCiphertext!, KEY)).toBe(TOKEN);
    expect(location(response)).not.toContain(TOKEN);
    expect(logged).not.toHaveBeenCalled();

    // The same state cannot be replayed.
    const replay = await callback(callbackRequest(`code=${CODE}&state=${state}`));
    expect(location(replay)).toBe('https://app.test/accounts?error=invalid_state');
  });

  it('handles refusal, a forged or foreign state, and a signed-out browser without calling Meta', async () => {
    const meta = fakeMeta(connected());
    current.meta = meta.config;
    const state = await createOAuthState(db, current.user!.id);

    expect(location(await callback(callbackRequest(`error=access_denied&error_reason=user_denied&error_description=Permissions+error&state=${state}`))))
      .toBe('https://app.test/accounts?error=denied');
    expect(location(await callback(callbackRequest(`code=${CODE}&state=forged`)))).toBe('https://app.test/accounts?error=invalid_state');
    expect(location(await callback(callbackRequest(`code=${CODE}`)))).toBe('https://app.test/accounts?error=invalid_state');

    current.user = await createUser(db); // someone else's browser
    expect(location(await callback(callbackRequest(`code=${CODE}&state=${state}`)))).toBe('https://app.test/accounts?error=invalid_state');

    current.user = null;
    expect(location(await callback(callbackRequest(`code=${CODE}&state=${state}`)))).toBe('https://app.test/login');
    expect(meta.calls).toHaveLength(0);
  });

  it('reports each failure with its own code and logs no secret', async () => {
    const run = async (routes: Parameters<typeof fakeMeta>[0], env: Partial<typeof ENV> = {}) => {
      setEnv(env);
      const meta = fakeMeta(routes);
      current.meta = meta.config;
      const state = await createOAuthState(db, current.user!.id);
      return { url: location(await callback(callbackRequest(`code=${CODE}&state=${state}`))), meta };
    };

    const noKey = await run(connected(), { TOKEN_ENCRYPTION_KEY: undefined });
    expect(noKey.url).toBe('https://app.test/accounts?error=encryption_key');
    expect(noKey.meta.count('GET oauth/access_token')).toBe(0); // the code is not spent

    const badCode = await run({ 'GET oauth/access_token': () => ({ status: 400, body: { error: { message: `Invalid verification code format. code=${CODE}`, code: 100 } } }) });
    expect(badCode.url).toBe('https://app.test/accounts?error=exchange_failed');

    const userToken = await run({ ...connected(), 'GET me/assigned_instagram_accounts': () => ({ status: 400, body: { error: { message: '(#100) Tried accessing nonexisting field (assigned_instagram_accounts) on node type (User)', code: 100 } } }) });
    expect(userToken.url).toBe('https://app.test/accounts?error=unsupported_token');

    const noAccount = await run({ ...connected(), 'GET me/assigned_instagram_accounts': () => ({ body: { data: [] } }) });
    expect(noAccount.url).toBe('https://app.test/accounts?error=no_account');

    const invalid = await run({ ...connected(), 'GET debug_token': () => ({ body: { data: { is_valid: false } } }) });
    expect(invalid.url).toBe('https://app.test/accounts?error=invalid_token');

    const down = await run({ ...connected(), 'GET me/assigned_instagram_accounts': () => ({ status: 503, body: 'unavailable' }) });
    expect(down.url).toBe('https://app.test/accounts?error=failed');
    expect(logged).toHaveBeenCalledTimes(1);

    const output = logged.mock.calls.flat().join(' ');
    for (const secret of [TOKEN, CODE, 'test-app-secret', KEY]) expect(output).not.toContain(secret);
  });
});
