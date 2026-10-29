import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { approveDraft, createDraft, editDraft, scheduleDraft } from '@/server/content/service';
import { encryptSecret } from '@/server/crypto';
import type { Db } from '@/server/db';
import { activity, brandProfiles, contentDrafts, instagramAccounts, publishingJobs, publishLogs } from '@/server/db/schema';
import { claimDueJobs } from '@/server/jobs/queue';
import { processPublishJob, type PublishDeps } from '@/server/jobs/publish';
import type { MediaStorage } from '@/server/media/storage';

import { createTestDb } from './helpers/db';
import { fakeMeta, validToken } from './helpers/fake-meta';
import { createAccount, createMedia, createUser, payload } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

const KEY = Buffer.alloc(32, 9).toString('base64');
const TOKEN = 'EAApublishingtesttoken0123456789';
const storage: MediaStorage = { kind: 'local', put: async () => undefined, read: async () => Buffer.alloc(0), remove: async () => undefined, publicUrl: async (key) => `https://media.test/${key}` };

/** An approved, scheduled feed post whose job is due now. */
async function dueJob(options: { publishingEnabled?: boolean } = {}) {
  const owner = await createUser(db);
  await db.insert(brandProfiles).values({ ownerId: owner.id, name: 'Euro Digital', publishingEnabled: options.publishingEnabled ?? true });
  const account = await createAccount(db, owner.id, { tokenCiphertext: encryptSecret(TOKEN, KEY), igUserId: '1784100' });
  const media = await createMedia(db, owner.id, 'image/jpeg');
  const { draft, version } = await createDraft(db, { ownerId: owner.id, userId: owner.id, kind: 'feed_image', title: 'Post', payload: payload(), mediaAssetId: media.id });
  await approveDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, versionId: version.id });
  const { job } = await scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: new Date(Date.now() + 120_000), timezone: 'Africa/Casablanca', instagramAccountId: account.id });
  await db.update(publishingJobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(publishingJobs.id, job.id));
  return { owner, account, draft, version, job, media };
}

const deps = (config: PublishDeps['meta'], fetchImpl: typeof fetch, overrides: Partial<PublishDeps> = {}): PublishDeps => ({
  db, meta: config, storage, encryptionKey: KEY, publishingMode: 'live', fetchImpl, ...overrides,
});

const mediaOk = () => ({ status: 206, body: 'jpeg-bytes', headers: { 'content-type': 'image/jpeg' } });

async function claim(jobId: string) {
  const jobs = await claimDueJobs(db, 'test-worker', 50);
  expect(jobs.map((j) => j.id)).toContain(jobId);
}

async function stateOf(draftId: string, jobId: string) {
  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId));
  const [job] = await db.select().from(publishingJobs).where(eq(publishingJobs.id, jobId));
  return { draft: draft!, job: job! };
}

describe('publishing through the official API', () => {
  it('creates the container, waits for FINISHED, publishes once and records the media ID', async () => {
    const { draft, job, media } = await dueJob();
    const meta = fakeMeta({
      'GET debug_token': validToken(),
      [`GET media.test/${media.storageKey}`]: mediaOk,
      'POST 1784100/media': () => ({ body: { id: 'container-1' } }),
      'GET container-1': () => ({ body: { status_code: 'FINISHED' } }),
      'POST 1784100/media_publish': () => ({ body: { id: 'ig-media-1' } }),
    });
    await claim(job.id);
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), job.id)).toBe('succeeded');

    const { draft: after, job: done } = await stateOf(draft.id, job.id);
    expect(after).toMatchObject({ status: 'published', publishedMediaId: 'ig-media-1' });
    expect(done).toMatchObject({ status: 'succeeded', igMediaId: 'ig-media-1', containerId: 'container-1' });
    const create = meta.calls.find((c) => c.path === '1784100/media')!;
    expect(create.params.get('image_url')).toBe(`https://media.test/${media.storageKey}`);
    expect(create.params.get('caption')).toContain('#ordinateur #maroc');
    expect(meta.count('POST 1784100/media_publish')).toBe(1);
    const notices = await db.select().from(activity).where(eq(activity.draftId, draft.id));
    expect(notices.map((n) => n.type)).toContain('published');
  });

  it('publishes nothing while publishing is disabled on the server or in Settings', async () => {
    for (const [mode, enabled] of [['disabled', true], ['live', false]] as const) {
      const { draft, job } = await dueJob({ publishingEnabled: enabled });
      const meta = fakeMeta({ 'GET debug_token': validToken() });
      await claim(job.id);
      expect(await processPublishJob(deps(meta.config, meta.fetchImpl, { publishingMode: mode }), job.id)).toBe('failed');
      expect(meta.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      const { draft: after } = await stateOf(draft.id, job.id);
      expect(after.status).toBe('failed');
      expect(after.lastError).toMatch(/Nothing was sent to Instagram/);
    }
  });

  it('never publishes a version that changed after approval', async () => {
    const { owner, draft, job } = await dueJob();
    await editDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, payload: payload({ caption: 'Changed after approval' }) });
    expect((await claimDueJobs(db, 'w', 50)).map((j) => j.id)).not.toContain(job.id); // cancelled by the edit

    // Even if a job slipped through, the worker refuses a version that is not the approved one.
    const second = await dueJob();
    await db.update(contentDrafts).set({ approvedVersionId: null }).where(eq(contentDrafts.id, second.draft.id));
    const meta = fakeMeta({ 'GET debug_token': validToken() });
    await claim(second.job.id);
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), second.job.id)).toBe('failed');
    expect(meta.calls).toHaveLength(0);
  });

  it('retries a transient failure with backoff and reuses the container: one publish only', async () => {
    const { draft, job, media } = await dueJob();
    const meta = fakeMeta({
      'GET debug_token': validToken(),
      [`GET media.test/${media.storageKey}`]: mediaOk,
      'POST 1784100/media': () => ({ body: { id: 'container-2' } }),
      'GET container-2': () => ({ body: { status_code: 'FINISHED' } }),
      'POST 1784100/media_publish': [
        () => ({ status: 500, body: { error: { message: 'An unexpected error has occurred', code: 2, is_transient: true } } }),
        () => ({ body: { id: 'ig-media-2' } }),
      ],
    });
    await claim(job.id);
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), job.id)).toBe('retry');
    let state = await stateOf(draft.id, job.id);
    expect(state.job.status).toBe('queued');
    expect(state.job.runAt.getTime()).toBeGreaterThan(Date.now() + 50_000); // ~1 minute backoff
    expect(state.draft.status).toBe('scheduled');

    await db.update(publishingJobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(publishingJobs.id, job.id));
    await claim(job.id);
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), job.id)).toBe('succeeded');
    state = await stateOf(draft.id, job.id);
    expect(state.job.attempts).toBe(2);
    expect(meta.count('POST 1784100/media')).toBe(1); // container created once
    const logs = await db.select().from(publishLogs).where(eq(publishLogs.jobId, job.id));
    expect(logs.map((l) => l.outcome)).toEqual(expect.arrayContaining(['retry', 'ok']));
  });

  it('does not publish again when the container was already published by a crashed attempt', async () => {
    const { draft, job } = await dueJob();
    await db.update(publishingJobs).set({ containerId: 'container-3', containerCreatedAt: new Date() }).where(eq(publishingJobs.id, job.id));
    const meta = fakeMeta({ 'GET debug_token': validToken(), 'GET container-3': () => ({ body: { status_code: 'PUBLISHED' } }) });
    await claim(job.id);
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), job.id)).toBe('succeeded');
    expect(meta.count('POST 1784100/media_publish')).toBe(0);
    expect((await stateOf(draft.id, job.id)).draft.status).toBe('published');
  });

  it('waits while Meta processes the media without using up attempts', async () => {
    const { job, media } = await dueJob();
    const meta = fakeMeta({
      'GET debug_token': validToken(),
      [`GET media.test/${media.storageKey}`]: mediaOk,
      'POST 1784100/media': () => ({ body: { id: 'container-4' } }),
      'GET container-4': () => ({ body: { status_code: 'IN_PROGRESS' } }),
    });
    await claim(job.id);
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), job.id)).toBe('polling');
    const [after] = await db.select().from(publishingJobs).where(eq(publishingJobs.id, job.id));
    expect(after).toMatchObject({ status: 'queued', attempts: 0, containerId: 'container-4' });
  });

  it('fails without retrying when access was revoked, and asks to reconnect', async () => {
    const { account, draft, job, media } = await dueJob();
    const meta = fakeMeta({
      'GET debug_token': validToken(),
      [`GET media.test/${media.storageKey}`]: mediaOk,
      'POST 1784100/media': () => ({ status: 400, body: { error: { message: 'Error validating access token: the user has removed the app', code: 190 } } }),
    });
    await claim(job.id);
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), job.id)).toBe('failed');
    const [acc] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, account.id));
    expect(acc!.status).toBe('needs_reauth');
    expect((await stateOf(draft.id, job.id)).draft.lastError).not.toContain(TOKEN);
  });

  it('stops after the maximum number of attempts', async () => {
    const { draft, job, media } = await dueJob();
    await db.update(publishingJobs).set({ attempts: 4, maxAttempts: 5 }).where(eq(publishingJobs.id, job.id));
    const meta = fakeMeta({
      'GET debug_token': validToken(),
      [`GET media.test/${media.storageKey}`]: mediaOk,
      'POST 1784100/media': () => ({ status: 503, body: 'down' }),
    });
    await claim(job.id); // attempt 5
    expect(await processPublishJob(deps(meta.config, meta.fetchImpl), job.id)).toBe('failed');
    expect((await stateOf(draft.id, job.id)).job.status).toBe('failed');
  });

  it('never hands the same due job to two claims', async () => {
    const { job } = await dueJob();
    const first = await claimDueJobs(db, 'worker-a', 50);
    const second = await claimDueJobs(db, 'worker-b', 50);
    expect(first.map((j) => j.id)).toContain(job.id);
    expect(second.map((j) => j.id)).not.toContain(job.id);
  });
});
