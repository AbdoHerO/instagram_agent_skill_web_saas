import { and, desc, eq } from 'drizzle-orm';

import { logActivity } from '@/server/activity';
import type { Db } from '@/server/db';
import { approvals, brandProfiles, contentDrafts, contentVersions, instagramAccounts, mediaAssets, publishingJobs, publishLogs } from '@/server/db/schema';
import type { ContentPayload } from '@/server/content/types';
import { PUBLISHABLE_KINDS, type DraftKind } from '@/server/content/workflow';
import { checkPublicMedia } from '@/server/media/service';
import type { MediaStorage } from '@/server/media/storage';
import { accountToken, inspectToken, REQUIRED_SCOPES } from '@/server/meta/accounts';
import { MetaApiError, type MetaConfig } from '@/server/meta/graph';
import { containerStatus, createContainer, postCaption, publishContainer } from '@/server/meta/publishing';

import { backoffSeconds } from './queue';

/**
 * Publishes one claimed job through the official API. Everything is checked
 * again at publish time, because hours may have passed since scheduling:
 *   approval of this exact version (hash) - both publishing switches - the
 *   account's access and permission - the media is reachable by Meta.
 * Duplicate protection: the container ID is saved before publishing; a
 * container already PUBLISHED, or a job that already has a media ID, is never
 * published again.
 */
export type PublishDeps = {
  db: Db;
  meta: MetaConfig;
  storage: MediaStorage;
  encryptionKey: string | undefined;
  publishingMode: 'disabled' | 'live';
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type Outcome = 'succeeded' | 'retry' | 'polling' | 'failed';

class PermanentFailure extends Error {
  constructor(message: string, readonly metaCode: number | null = null) {
    super(message);
  }
}

const CONTAINER_TIMEOUT_MS = 15 * 60_000;
const POLL_SECONDS = 60;

export async function processPublishJob(deps: PublishDeps, jobId: string): Promise<Outcome> {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const [job] = await db.select().from(publishingJobs).where(eq(publishingJobs.id, jobId));
  if (!job || job.status !== 'running') return 'failed';
  const log = (step: string, outcome: string, message: string | null, metaErrorCode: number | null = null) =>
    db.insert(publishLogs).values({ jobId: job.id, draftId: job.draftId, step, outcome, message, metaErrorCode });

  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, job.draftId));
  try {
    if (!draft) throw new PermanentFailure('The draft no longer exists.');

    // 1. Approval: the approved version is still the current one, and this job is for it.
    if (!['scheduled', 'publishing'].includes(draft.status)) throw new PermanentFailure(`The post is ${draft.status}, not scheduled.`);
    if (draft.approvedVersionId !== job.versionId || draft.currentVersionId !== job.versionId) {
      throw new PermanentFailure('The post changed after approval: approve the new version and schedule it again.');
    }
    const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, job.versionId));
    const [lastDecision] = await db.select().from(approvals).where(eq(approvals.versionId, job.versionId)).orderBy(desc(approvals.createdAt)).limit(1);
    if (!version || lastDecision?.decision !== 'approved' || lastDecision.contentHash !== version.contentHash) {
      throw new PermanentFailure('No valid approval for this exact content.');
    }
    if (!PUBLISHABLE_KINDS.includes(draft.kind as DraftKind)) throw new PermanentFailure('This post type is not published through the API in this release.');

    // 2. Both switches must allow publishing.
    const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.ownerId, job.ownerId));
    if (deps.publishingMode !== 'live') throw new PermanentFailure('Publishing is disabled on the server (PUBLISHING_MODE is not "live"). Nothing was sent to Instagram.');
    if (!brand?.publishingEnabled) throw new PermanentFailure('Publishing is switched off in Settings. Nothing was sent to Instagram.');

    if (draft.status === 'scheduled') {
      await db.update(contentDrafts).set({ status: 'publishing', updatedAt: now() }).where(eq(contentDrafts.id, draft.id));
    }

    // 3. Account access and permission, checked with Meta now.
    const [account] = await db.select().from(instagramAccounts).where(and(eq(instagramAccounts.id, job.instagramAccountId), eq(instagramAccounts.ownerId, job.ownerId)));
    if (!account || account.status !== 'connected') throw new PermanentFailure('The Instagram account is not connected. Reconnect it, then schedule again.');
    const token = accountToken(account, deps.encryptionKey);
    const tokenInfo = await inspectToken(deps.meta, token);
    if (!tokenInfo.isValid) {
      await db.update(instagramAccounts).set({ status: 'needs_reauth', lastError: 'Access invalid at publish time', updatedAt: now() }).where(eq(instagramAccounts.id, account.id));
      throw new PermanentFailure('Instagram access is no longer valid. Reconnect the account.', 190);
    }
    if (!tokenInfo.scopes.includes(REQUIRED_SCOPES.publish)) throw new PermanentFailure('Permission instagram_content_publish is not granted to this app.', 10);

    // Already published by an earlier attempt: never publish twice.
    if (job.igMediaId) return await succeed(deps, job, draft.title, job.igMediaId, log);

    // 4. Media reachable by Meta, with the right type.
    const [media] = version.mediaAssetId ? await db.select().from(mediaAssets).where(eq(mediaAssets.id, version.mediaAssetId)) : [];
    if (!media) throw new PermanentFailure('The post has no media attached.');
    const expected = draft.kind === 'reel' ? 'video/mp4' : 'image/jpeg';
    if (media.mimeType !== expected) throw new PermanentFailure(`A ${draft.kind === 'reel' ? 'Reel needs an MP4 video' : 'feed post needs a JPEG image'}.`);
    const mediaUrl = await deps.storage.publicUrl(media.storageKey);
    if (!mediaUrl) throw new PermanentFailure('No public media URL is configured (MEDIA_PUBLIC_BASE_URL or S3): Meta cannot download the file.');
    if (!job.containerId) {
      const reachable = await checkPublicMedia(mediaUrl, expected, deps.fetchImpl);
      if (!reachable.ok) {
        if (reachable.transient) throw new MetaApiError(reachable.reason ?? 'Media unreachable', 0, null, null, true);
        throw new PermanentFailure(reachable.reason ?? 'Media unreachable');
      }
    }

    // 5. Container: create once, remember it, wait until Meta has processed it.
    let containerId = job.containerId;
    if (!containerId) {
      const payload = version.payload as ContentPayload;
      containerId = await createContainer(deps.meta, token, account.igUserId, {
        kind: draft.kind as 'feed_image' | 'reel', mediaUrl, caption: postCaption(version.caption, version.hashtags), altText: payload.altText,
      });
      job.containerCreatedAt = now();
      await db.update(publishingJobs).set({ containerId, containerCreatedAt: job.containerCreatedAt, updatedAt: now() }).where(eq(publishingJobs.id, job.id));
      await log('create_container', 'ok', `Container ${containerId} created`);
    }
    const status = await containerStatus(deps.meta, token, containerId);
    if (status.status === 'PUBLISHED') {
      await log('check_container', 'ok', 'Container already published by an earlier attempt: not published again.');
      return await succeed(deps, job, draft.title, null, log);
    }
    if (status.status === 'ERROR') throw new PermanentFailure(`Meta could not process the media${status.detail ? `: ${status.detail}` : ''}.`);
    if (status.status === 'EXPIRED') {
      await db.update(publishingJobs).set({ containerId: null, containerCreatedAt: null, updatedAt: now() }).where(eq(publishingJobs.id, job.id));
      throw new MetaApiError('The container expired before publishing; a new one will be created.', 0, null, null, true);
    }
    if (status.status === 'IN_PROGRESS') {
      if (job.containerCreatedAt && now().getTime() - job.containerCreatedAt.getTime() > CONTAINER_TIMEOUT_MS) {
        throw new PermanentFailure('Meta was still processing the media after 15 minutes.');
      }
      // Check again in a minute; polling does not use up retry attempts.
      await db.update(publishingJobs).set({ status: 'queued', attempts: Math.max(job.attempts - 1, 0), runAt: new Date(now().getTime() + POLL_SECONDS * 1000), lockedAt: null, lockedBy: null, updatedAt: now() })
        .where(eq(publishingJobs.id, job.id));
      await log('check_container', 'waiting', 'Meta is processing the media; checking again in one minute.');
      return 'polling';
    }

    // 6. Publish.
    const mediaId = await publishContainer(deps.meta, token, account.igUserId, containerId);
    await log('publish', 'ok', `Published as media ${mediaId}`);
    return await succeed(deps, job, draft.title, mediaId, log);
  } catch (error) {
    return handleFailure(deps, job, draft?.title ?? 'Post', error, log);
  }
}

async function succeed(deps: PublishDeps, job: typeof publishingJobs.$inferSelect, title: string, mediaId: string | null, log: (s: string, o: string, m: string | null) => Promise<unknown>): Promise<Outcome> {
  const at = deps.now?.() ?? new Date();
  await deps.db.update(publishingJobs).set({ status: 'succeeded', igMediaId: mediaId ?? job.igMediaId, finishedAt: at, lockedAt: null, lockedBy: null, lastError: null, updatedAt: at }).where(eq(publishingJobs.id, job.id));
  await deps.db.update(contentDrafts).set({ status: 'published', publishedMediaId: mediaId ?? job.igMediaId, publishedAt: at, lastError: null, updatedAt: at }).where(eq(contentDrafts.id, job.draftId));
  await logActivity(deps.db, { ownerId: job.ownerId, draftId: job.draftId, type: 'published', level: 'success', message: `"${title}" was published on Instagram` });
  if (!mediaId && !job.igMediaId) await log('publish', 'warning', 'Published, but the media ID could not be recorded.');
  return 'succeeded';
}

async function handleFailure(deps: PublishDeps, job: typeof publishingJobs.$inferSelect, title: string, error: unknown, log: (s: string, o: string, m: string | null, c?: number | null) => Promise<unknown>): Promise<Outcome> {
  const at = deps.now?.() ?? new Date();
  const meta = error instanceof MetaApiError ? error : null;
  const message = error instanceof Error ? error.message : 'Unknown error';
  const retryable = Boolean(meta?.transient) && job.attempts < job.maxAttempts;

  if (meta?.isAuth) {
    await deps.db.update(instagramAccounts).set({ status: 'needs_reauth', lastError: message, updatedAt: at }).where(eq(instagramAccounts.id, job.instagramAccountId));
  }
  if (retryable) {
    const delay = backoffSeconds(job.attempts);
    await deps.db.update(publishingJobs).set({ status: 'queued', runAt: new Date(at.getTime() + delay * 1000), lastError: message, lockedAt: null, lockedBy: null, updatedAt: at }).where(eq(publishingJobs.id, job.id));
    await deps.db.update(contentDrafts).set({ status: 'scheduled', lastError: `Retrying: ${message}`, updatedAt: at }).where(eq(contentDrafts.id, job.draftId));
    await log('attempt', 'retry', `Attempt ${job.attempts} failed, retrying in ${Math.round(delay / 60)} min: ${message}`, meta?.code ?? null);
    return 'retry';
  }
  await deps.db.update(publishingJobs).set({ status: 'failed', lastError: message, finishedAt: at, lockedAt: null, lockedBy: null, updatedAt: at }).where(eq(publishingJobs.id, job.id));
  await deps.db.update(contentDrafts).set({ status: 'failed', lastError: message, updatedAt: at }).where(eq(contentDrafts.id, job.draftId));
  await log('attempt', 'failed', message, meta?.code ?? (error instanceof PermanentFailure ? error.metaCode : null));
  await logActivity(deps.db, { ownerId: job.ownerId, draftId: job.draftId, type: 'publish_failed', level: 'error', message: `Publishing "${title}" failed: ${message}` });
  return 'failed';
}
