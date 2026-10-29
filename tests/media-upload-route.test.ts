import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/drafts/[id]/media/route';
import { archiveDraft, createDraft } from '@/server/content/service';
import type { Db } from '@/server/db';
import { contentDrafts, contentVersions } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { localStorage } from '@/server/media/storage';

import { createTestDb } from './helpers/db';
import { createUser, payload } from './helpers/fixtures';

/** POST /api/drafts/[id]/media: uploads go through a route handler (Cloudflare blocks binary Server Action bodies). */
const current = vi.hoisted(() => ({ user: null as { id: string } | null, db: null as unknown, dir: '' }));
vi.mock('@/server/auth/session', () => ({ currentUser: async () => current.user }));
vi.mock('@/server/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/db')>()), getDb: () => current.db }));
vi.mock('@/server/app', () => ({ mediaStorage: () => localStorage(current.dir, undefined) }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  current.db = db;
  current.dir = mkdtempSync(join(tmpdir(), 'agent-media-'));
  process.env.APP_URL = 'https://app.test';
  process.env.MEDIA_MAX_BYTES = String(1024 * 1024);
  resetEnvCache();
});
afterAll(async () => {
  await close();
  rmSync(current.dir, { recursive: true, force: true });
  delete process.env.MEDIA_MAX_BYTES;
  resetEnvCache();
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
function upload(draftId: string, file: Buffer | null, { origin = 'https://app.test', type = 'image/jpeg', length }: { origin?: string | null; type?: string; length?: number } = {}) {
  const form = new FormData();
  if (file) form.append('file', new File([new Uint8Array(file)], 'photo.jpg', { type }));
  const headers = new Headers({ host: 'app.test' });
  if (origin) headers.set('origin', origin);
  if (length) headers.set('content-length', String(length));
  return POST(new NextRequest(`https://app.test/api/drafts/${draftId}/media`, { method: 'POST', body: form, headers }), { params: Promise.resolve({ id: draftId }) });
}
const filesOnDisk = () => readdirSync(current.dir, { recursive: true }).filter((name) => String(name).endsWith('.jpg')).length;

let ownerDraft: string;
beforeEach(async () => {
  current.user = await createUser(db);
  const { draft } = await createDraft(db, { ownerId: current.user.id, userId: current.user.id, kind: 'feed_image', title: 'Post', payload: payload() });
  ownerDraft = draft.id;
});

describe('POST /api/drafts/[id]/media', () => {
  it('attaches a JPEG to the draft in a new version', async () => {
    const response = await upload(ownerDraft, JPEG);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, ownerDraft));
    const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, draft!.currentVersionId!));
    expect(version).toMatchObject({ version: 2 });
    expect(version!.mediaAssetId).not.toBeNull();
  });

  it('refuses a signed-out request, another site, another owner\'s draft, a wrong type and an oversized body', async () => {
    const before = filesOnDisk();
    const mine = current.user;
    current.user = null;
    expect((await upload(ownerDraft, JPEG)).status).toBe(401);
    current.user = mine;
    expect((await upload(ownerDraft, JPEG, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await upload(ownerDraft, JPEG, { origin: null })).status).toBe(403);
    current.user = await createUser(db); // someone else
    expect((await upload(ownerDraft, JPEG)).status).toBe(404);
    current.user = mine;
    const notImage = await upload(ownerDraft, Buffer.from('not an image at all'), { type: 'image/jpeg' });
    expect(notImage.status).toBe(400);
    expect((await notImage.json()).error).toMatch(/Only JPEG images/);
    expect((await upload(ownerDraft, JPEG, { length: 3 * 1024 * 1024 })).status).toBe(413);
    expect((await upload(ownerDraft, null)).status).toBe(400);
    expect(filesOnDisk()).toBe(before); // nothing was stored by any refused request
  });

  it('refuses a draft that can no longer change, before storing the file', async () => {
    await archiveDraft(db, current.user!.id, ownerDraft);
    const before = filesOnDisk();
    const response = await upload(ownerDraft, JPEG);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/archived cannot be changed/);
    expect(filesOnDisk()).toBe(before);
  });
});
