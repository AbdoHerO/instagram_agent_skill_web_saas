import { NextResponse, type NextRequest } from 'next/server';

import { metaConfig } from '@/server/app';
import { currentUser } from '@/server/auth/session';
import { isValidEncryptionKey } from '@/server/crypto';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import { connectAccounts, ConnectionProblem } from '@/server/meta/accounts';
import { MetaApiError } from '@/server/meta/graph';
import { consumeOAuthState, exchangeCode, OAuthError } from '@/server/meta/oauth';

export const dynamic = 'force-dynamic';

/**
 * Meta redirects here (the exact META_REDIRECT_URI) with ?code=&state= or an
 * error. The state is checked against the signed-in user, the code is exchanged
 * server-side, and the token is stored encrypted. Neither the code nor the token
 * is logged or sent back to the browser.
 */
export async function GET(request: NextRequest) {
  const appUrl = env().APP_URL;
  const back = (query: string) => NextResponse.redirect(new URL(`/accounts?${query}`, appUrl));
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', appUrl));

  const params = request.nextUrl.searchParams;
  if (params.get('error')) return back('error=denied');
  const db = getDb();
  try {
    await consumeOAuthState(db, user.id, params.get('state'));
    const code = params.get('code');
    if (!code || code.length > 2000) throw new OAuthError('Missing authorization code', 'exchange_failed');
    if (!isValidEncryptionKey(env().TOKEN_ENCRYPTION_KEY)) throw new OAuthError('TOKEN_ENCRYPTION_KEY is missing or invalid', 'encryption_key');
    const { accessToken } = await exchangeCode(metaConfig(), code);
    const accounts = await connectAccounts(db, metaConfig(), { ownerId: user.id, token: accessToken, encryptionKey: env().TOKEN_ENCRYPTION_KEY });
    return back(`connected=${accounts.length}`);
  } catch (error) {
    if (error instanceof OAuthError || error instanceof ConnectionProblem) return back(`error=${error.code}`);
    console.error('[oauth] connection failed:', error instanceof MetaApiError ? `Meta error ${error.code ?? error.status}` : error instanceof Error ? error.name : 'error');
    return back('error=failed');
  }
}
