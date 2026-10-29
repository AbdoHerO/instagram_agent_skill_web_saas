import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getDb, isDatabaseConfigured } from '@/server/db';
import { env } from '@/server/env';

import { createSession, revokeSession, SESSION_COOKIE, userForSession, type SessionUser } from './core';

/** The signed-in user, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  if (!isDatabaseConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userForSession(getDb(), token);
  return user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
}

/** For pages and server actions: the signed-in user, or a redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(getDb(), userId, env().SESSION_TTL_HOURS);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  await revokeSession(getDb(), store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
}
