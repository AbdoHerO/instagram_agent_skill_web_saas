import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, lt } from 'drizzle-orm';

import { randomToken, sha256 } from '@/server/crypto';
import { insertRow, type Db } from '@/server/db';
import { brandProfiles, sessions, users } from '@/server/db/schema';

/**
 * Accounts and sessions, independent of Next.js (tested directly). The browser
 * holds a random session token in an httpOnly cookie; the database keeps only
 * its SHA-256 hash, so a database leak does not leak sessions.
 */
export const SESSION_COOKIE = 'ig_session';
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  return hash(password);
}

export async function createUserAccount(db: Db, input: { email: string; name: string; password: string; role?: 'owner' | 'editor' }) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const user = await insertRow(tx as unknown as Db, users, { email: input.email.trim().toLowerCase(), name: input.name.trim(), passwordHash, role: input.role ?? 'owner' });
    await tx.insert(brandProfiles).values({ ownerId: user.id, name: 'Euro Digital' });
    return user;
  });
}

/** Same work whether the email exists or not (no account enumeration by timing). */
let dummyHash: Promise<string> | null = null;

export async function verifyCredentials(db: Db, email: string, password: string) {
  // Emails are stored lower-case and the column's collation is case-insensitive.
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  dummyHash ??= hash(randomToken());
  const ok = await verify(user?.passwordHash ?? (await dummyHash), password).catch(() => false);
  return ok && user ? user : null;
}

export async function createSession(db: Db, userId: string, ttlHours: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  return { token, expiresAt };
}

export async function userForSession(db: Db, token: string | undefined | null) {
  if (!token || token.length > 200) return null;
  const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

export async function revokeSession(db: Db, token: string | undefined | null) {
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export type SessionUser = { id: string; email: string; name: string; role: string };
