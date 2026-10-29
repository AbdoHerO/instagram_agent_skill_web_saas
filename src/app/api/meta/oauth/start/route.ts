import { NextResponse } from 'next/server';

import { metaConfig } from '@/server/app';
import { currentUser } from '@/server/auth/session';
import { isValidEncryptionKey } from '@/server/crypto';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import { missingConfig } from '@/server/meta/graph';
import { authorizeUrl, createOAuthState, OAuthError, redirectUriProblems } from '@/server/meta/oauth';

export const dynamic = 'force-dynamic';

/**
 * Starts Unified Login: a single-use state bound to the signed-in user, then
 * Meta's dialog. Refuses first when the connection could not be completed
 * (Meta settings missing, no encryption key to store the token, or a redirect
 * URI that would lose the session), so nobody goes through Meta for nothing.
 */
export async function GET() {
  const user = await currentUser();
  const config = env();
  if (!user) return NextResponse.redirect(new URL('/login', config.APP_URL));
  const back = (code: string) => NextResponse.redirect(new URL(`/accounts?error=${code}`, config.APP_URL));
  if (missingConfig(metaConfig()).length) return back('not_configured');
  if (!isValidEncryptionKey(config.TOKEN_ENCRYPTION_KEY)) return back('encryption_key');
  if (redirectUriProblems(config.APP_URL, config.META_REDIRECT_URI).errors.length) return back('redirect_uri');
  try {
    const state = await createOAuthState(getDb(), user.id);
    return NextResponse.redirect(authorizeUrl(metaConfig(), state));
  } catch (error) {
    return back(error instanceof OAuthError ? error.code : 'failed');
  }
}
