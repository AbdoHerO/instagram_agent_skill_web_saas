import { NextResponse } from 'next/server';

import { metaConfig } from '@/server/app';
import { currentUser } from '@/server/auth/session';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import { authorizeUrl, createOAuthState, OAuthError } from '@/server/meta/oauth';

export const dynamic = 'force-dynamic';

/** Starts Unified Login: a single-use state bound to the signed-in user, then Meta's dialog. */
export async function GET() {
  const user = await currentUser();
  const appUrl = env().APP_URL;
  if (!user) return NextResponse.redirect(new URL('/login', appUrl));
  try {
    const state = await createOAuthState(getDb(), user.id);
    return NextResponse.redirect(authorizeUrl(metaConfig(), state));
  } catch (error) {
    const code = error instanceof OAuthError ? error.code : 'failed';
    return NextResponse.redirect(new URL(`/accounts?error=${code}`, appUrl));
  }
}
