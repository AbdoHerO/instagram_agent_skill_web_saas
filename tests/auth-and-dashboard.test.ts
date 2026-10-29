import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recentActivity } from '@/server/activity';
import { createSession, createUserAccount, revokeSession, userForSession, verifyCredentials } from '@/server/auth/core';
import { getBrand } from '@/server/brand';
import { draftCounts, failedJobCount, listDrafts } from '@/server/content/service';
import { encryptSecret, decryptSecret } from '@/server/crypto';
import type { Db } from '@/server/db';
import { sessions, users } from '@/server/db/schema';

import { createTestDb } from './helpers/db';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

describe('accounts and sessions', () => {
  it('stores an argon2 hash, refuses short passwords and wrong credentials', async () => {
    await expect(createUserAccount(db, { email: 'short@example.test', name: 'X', password: 'short' })).rejects.toThrow(/at least 12/);
    const user = await createUserAccount(db, { email: 'Owner@Example.test', name: 'Owner', password: 'correct horse battery' });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row!.passwordHash).not.toContain('correct horse');
    expect(await verifyCredentials(db, 'owner@example.test', 'correct horse battery')).toMatchObject({ id: user.id });
    expect(await verifyCredentials(db, 'owner@example.test', 'wrong password!!')).toBeNull();
    expect(await verifyCredentials(db, 'nobody@example.test', 'correct horse battery')).toBeNull();
    await expect(createUserAccount(db, { email: 'OWNER@example.test', name: 'Dup', password: 'another long password' })).rejects.toThrow();
  });

  it('keeps only the session hash, expires and revokes sessions', async () => {
    const user = await createUserAccount(db, { email: 'session@example.test', name: 'S', password: 'a long enough password' });
    const { token } = await createSession(db, user.id, 1);
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(row!.tokenHash).not.toBe(token);
    expect(await userForSession(db, token)).toMatchObject({ id: user.id });
    expect(await userForSession(db, 'forged-token')).toBeNull();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, user.id));
    expect(await userForSession(db, token)).toBeNull();
    const second = await createSession(db, user.id, 1);
    await revokeSession(db, second.token);
    expect(await userForSession(db, second.token)).toBeNull();
  });

  it('encrypts tokens with authentication: tampering or a wrong key fails', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    const packed = encryptSecret('EAAsecret', key);
    expect(decryptSecret(packed, key)).toBe('EAAsecret');
    expect(() => decryptSecret(packed, Buffer.alloc(32, 2).toString('base64'))).toThrow();
    const parts = packed.split('.');
    expect(() => decryptSecret([parts[0], parts[1], parts[2], 'AAAA'].join('.'), key)).toThrow();
    expect(() => encryptSecret('x', undefined)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});

describe('dashboard data for a new account', () => {
  it('starts empty, with a brand profile in Africa/Casablanca and publishing off', async () => {
    const user = await createUserAccount(db, { email: 'empty@example.test', name: 'E', password: 'a long enough password' });
    expect(await draftCounts(db, user.id)).toEqual({});
    expect(await failedJobCount(db, user.id)).toBe(0);
    expect(await listDrafts(db, user.id)).toEqual([]);
    expect(await recentActivity(db, user.id)).toEqual([]);
    const brand = await getBrand(db, user.id);
    expect(brand).toMatchObject({ timezone: 'Africa/Casablanca', publishingEnabled: false, defaultLanguage: 'fr' });
  });
});
