import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { logActivity } from '@/server/activity';
import { sha256 } from '@/server/crypto';
import { affectedRows, insertRow, updateRow, type Db } from '@/server/db';
import { approvals, contentDrafts, contentVersions, instagramAccounts, mediaAssets, publishingJobs, publishLogs } from '@/server/db/schema';

import { contentPayloadSchema, type ContentPayload, type VersionValidation } from './types';
import { hasBlockingIssues, validateContent } from './validate';
import { nextStatus, PUBLISHABLE_KINDS, WorkflowError, type DraftKind, type DraftStatus } from './workflow';

export class NotFoundError extends Error {}

/** Canonical hash of what an approval covers: the text, the tags and the attached media. */
export function contentHashOf(payload: ContentPayload, mediaAssetId: string | null): string {
  const canonical = JSON.stringify({ payload: sortKeys(payload), mediaAssetId });
  return sha256(canonical);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

async function ownedDraft(db: Db, ownerId: string, draftId: string) {
  const [draft] = await db.select().from(contentDrafts).where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.ownerId, ownerId)));
  if (!draft) throw new NotFoundError('Draft not found');
  return draft;
}

async function assertOwnedMedia(db: Db, ownerId: string, mediaAssetId: string | null) {
  if (!mediaAssetId) return;
  const [asset] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.id, mediaAssetId), eq(mediaAssets.ownerId, ownerId)));
  if (!asset) throw new NotFoundError('Media not found');
}

async function insertVersion(db: Db, input: { draftId: string; version: number; kind: DraftKind; payload: ContentPayload; mediaAssetId: string | null; userId: string; tools?: Record<string, unknown> }) {
  const payload = contentPayloadSchema.parse(input.payload);
  const validation: VersionValidation = {
    issues: validateContent(input.kind, payload, Boolean(input.mediaAssetId)),
    tools: input.tools,
    checkedAt: new Date().toISOString(),
  };
  return insertRow(db, contentVersions, {
    draftId: input.draftId,
    version: input.version,
    caption: payload.caption,
    hashtags: payload.hashtags,
    payload,
    mediaAssetId: input.mediaAssetId,
    validation,
    contentHash: contentHashOf(payload, input.mediaAssetId),
    createdBy: input.userId,
  });
}

/** Every generated or hand-written post starts here, as a draft. Never published from here. */
export async function createDraft(db: Db, input: {
  ownerId: string; userId: string; kind: DraftKind; title: string; payload: ContentPayload;
  mediaAssetId?: string | null; instagramAccountId?: string | null; timezone?: string; tools?: Record<string, unknown>;
}) {
  await assertOwnedMedia(db, input.ownerId, input.mediaAssetId ?? null);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const draft = await insertRow(t, contentDrafts, {
      ownerId: input.ownerId, kind: input.kind, title: input.title.slice(0, 200), status: 'draft',
      instagramAccountId: input.instagramAccountId ?? null, timezone: input.timezone ?? 'Africa/Casablanca',
    });
    const version = await insertVersion(t, { draftId: draft.id, version: 1, kind: input.kind, payload: input.payload, mediaAssetId: input.mediaAssetId ?? null, userId: input.userId, tools: input.tools });
    await tx.update(contentDrafts).set({ currentVersionId: version.id }).where(eq(contentDrafts.id, draft.id));
    await logActivity(t, { ownerId: input.ownerId, draftId: draft.id, type: 'draft_created', message: `Draft created: ${draft.title}` });
    return { draft: { ...draft, currentVersionId: version.id }, version };
  });
}

/**
 * An edit is a new immutable version. If the post was approved or scheduled,
 * the approval is invalidated and any queued publishing job is cancelled: the
 * new text must be approved again.
 */
export async function editDraft(db: Db, input: {
  ownerId: string; userId: string; draftId: string; title?: string; payload: ContentPayload; mediaAssetId?: string | null; tools?: Record<string, unknown>;
}) {
  const draft = await ownedDraft(db, input.ownerId, input.draftId);
  const status = nextStatus(draft.status as DraftStatus, 'edit');
  const mediaAssetId = input.mediaAssetId === undefined ? (await currentVersion(db, draft.currentVersionId))?.mediaAssetId ?? null : input.mediaAssetId;
  await assertOwnedMedia(db, input.ownerId, mediaAssetId);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(${contentVersions.version}), 0)` }).from(contentVersions).where(eq(contentVersions.draftId, draft.id));
    const version = await insertVersion(t, { draftId: draft.id, version: Number(max) + 1, kind: draft.kind as DraftKind, payload: input.payload, mediaAssetId, userId: input.userId, tools: input.tools });
    const wasApproved = draft.approvedVersionId !== null;
    if (wasApproved) {
      const [approved] = await tx.select().from(contentVersions).where(eq(contentVersions.id, draft.approvedVersionId!));
      await tx.insert(approvals).values({ draftId: draft.id, versionId: draft.approvedVersionId!, userId: input.userId, decision: 'invalidated', note: `Edited after approval (version ${version.version})`, contentHash: approved?.contentHash ?? '' });
    }
    const cancelled = affectedRows(await tx.update(publishingJobs).set({ status: 'cancelled', finishedAt: new Date(), lastError: 'Cancelled: the post was edited after approval', updatedAt: new Date() })
      .where(and(eq(publishingJobs.draftId, draft.id), eq(publishingJobs.status, 'queued'))));
    const updated = await updateRow(t, contentDrafts, draft.id, {
      currentVersionId: version.id, approvedVersionId: null, status, scheduledAt: null, title: input.title?.slice(0, 200) ?? draft.title, updatedAt: new Date(),
    });
    if (wasApproved || cancelled) {
      await logActivity(t, { ownerId: input.ownerId, draftId: draft.id, type: 'approval_invalidated', level: 'warning', message: `"${draft.title}" was edited: approval removed${cancelled ? ' and scheduling cancelled' : ''}. Approve the new version.` });
    }
    return { draft: updated, version };
  });
}

async function currentVersion(db: Db, versionId: string | null) {
  if (!versionId) return null;
  const [row] = await db.select().from(contentVersions).where(eq(contentVersions.id, versionId));
  return row ?? null;
}

export async function submitForApproval(db: Db, ownerId: string, draftId: string) {
  const draft = await ownedDraft(db, ownerId, draftId);
  const status = nextStatus(draft.status as DraftStatus, 'submit');
  const row = await updateRow(db, contentDrafts, draft.id, { status, updatedAt: new Date() });
  await logActivity(db, { ownerId, draftId, type: 'submitted', message: `"${draft.title}" is awaiting approval` });
  return row;
}

/** Explicit approval of the current version (blocked while it has unresolved issues). */
export async function approveDraft(db: Db, input: { ownerId: string; userId: string; draftId: string; versionId: string; note?: string }) {
  const draft = await ownedDraft(db, input.ownerId, input.draftId);
  const status = nextStatus(draft.status as DraftStatus, 'approve');
  if (draft.currentVersionId !== input.versionId) {
    throw new WorkflowError('This version is no longer the current one. Review the latest version.', 'stale_version');
  }
  const version = await currentVersion(db, draft.currentVersionId);
  if (!version) throw new NotFoundError('Version not found');
  const validation = version.validation as VersionValidation;
  if (hasBlockingIssues(validation.issues ?? [])) {
    throw new WorkflowError('Fix the blocking issues (placeholders, unverified prices or claims) before approving.', 'blocking_issues');
  }
  return db.transaction(async (tx) => {
    await tx.insert(approvals).values({ draftId: draft.id, versionId: version.id, userId: input.userId, decision: 'approved', note: input.note ?? null, contentHash: version.contentHash });
    const row = await updateRow(tx as unknown as Db, contentDrafts, draft.id, { status, approvedVersionId: version.id, updatedAt: new Date() });
    await logActivity(tx as unknown as Db, { ownerId: input.ownerId, draftId: draft.id, type: 'approved', level: 'success', message: `"${draft.title}" approved (version ${version.version})` });
    return row;
  });
}

export async function rejectDraft(db: Db, input: { ownerId: string; userId: string; draftId: string; note?: string }) {
  const draft = await ownedDraft(db, input.ownerId, input.draftId);
  const status = nextStatus(draft.status as DraftStatus, 'reject');
  const version = await currentVersion(db, draft.currentVersionId);
  return db.transaction(async (tx) => {
    await tx.insert(approvals).values({ draftId: draft.id, versionId: version!.id, userId: input.userId, decision: 'rejected', note: input.note ?? null, contentHash: version!.contentHash });
    const row = await updateRow(tx as unknown as Db, contentDrafts, draft.id, { status, approvedVersionId: null, updatedAt: new Date() });
    await logActivity(tx as unknown as Db, { ownerId: input.ownerId, draftId: draft.id, type: 'rejected', level: 'warning', message: `"${draft.title}" rejected${input.note ? `: ${input.note}` : ''}` });
    return row;
  });
}

/**
 * Schedules the approved version. Requires: the approved version is the current
 * one, a publishable post type with its media, a connected account of this
 * owner, and a time in the future. One job per approved version (idempotency key).
 */
export async function scheduleDraft(db: Db, input: { ownerId: string; draftId: string; runAt: Date; timezone: string; instagramAccountId: string; now?: Date }) {
  const draft = await ownedDraft(db, input.ownerId, input.draftId);
  const status = nextStatus(draft.status as DraftStatus, 'schedule');
  if (!draft.approvedVersionId || draft.approvedVersionId !== draft.currentVersionId) {
    throw new WorkflowError('Only the approved, unchanged version can be scheduled.', 'not_approved');
  }
  if (!PUBLISHABLE_KINDS.includes(draft.kind as DraftKind)) {
    throw new WorkflowError('This post type cannot be published through the API in this release (feed images and Reels only).', 'kind_not_publishable');
  }
  const version = await currentVersion(db, draft.approvedVersionId);
  if (!version?.mediaAssetId) throw new WorkflowError('Attach the media before scheduling.', 'media_missing');
  const now = input.now ?? new Date();
  if (input.runAt.getTime() < now.getTime() + 60_000) throw new WorkflowError('Choose a time at least one minute from now.', 'time_in_past');
  const [account] = await db.select().from(instagramAccounts).where(and(eq(instagramAccounts.id, input.instagramAccountId), eq(instagramAccounts.ownerId, input.ownerId)));
  if (!account) throw new NotFoundError('Instagram account not found');
  if (account.status !== 'connected') throw new WorkflowError('Reconnect the Instagram account before scheduling.', 'account_not_connected');

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: publishingJobs.id, status: publishingJobs.status }).from(publishingJobs)
      .where(eq(publishingJobs.idempotencyKey, `publish:${version.id}`));
    if (existing.some((job) => job.status === 'succeeded' || job.status === 'running')) {
      throw new WorkflowError('This version has already been published or is publishing.', 'already_published');
    }
    // Cancelled and failed jobs of this version stay as history; the unique index covers live ones only.
    const t = tx as unknown as Db;
    const job = await insertRow(t, publishingJobs, {
      ownerId: input.ownerId, draftId: draft.id, versionId: version.id, instagramAccountId: account.id,
      runAt: input.runAt, status: 'queued', idempotencyKey: `publish:${version.id}`,
    });
    const row = await updateRow(t, contentDrafts, draft.id, { status, scheduledAt: input.runAt, timezone: input.timezone, instagramAccountId: account.id, lastError: null, updatedAt: new Date() });
    await logActivity(t, { ownerId: input.ownerId, draftId: draft.id, type: 'scheduled', message: `"${draft.title}" scheduled for ${input.runAt.toISOString()} (${input.timezone}) on @${account.username}` });
    return { draft: row, job };
  });
}

/** Cancel before publishing: the queued job is cancelled, the post goes back to approved. */
export async function cancelSchedule(db: Db, ownerId: string, draftId: string) {
  const draft = await ownedDraft(db, ownerId, draftId);
  const status = nextStatus(draft.status as DraftStatus, 'unschedule');
  return db.transaction(async (tx) => {
    const cancelled = affectedRows(await tx.update(publishingJobs).set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(publishingJobs.draftId, draft.id), eq(publishingJobs.status, 'queued'))));
    if (!cancelled) throw new WorkflowError('The post is already being published and can no longer be cancelled.', 'job_running');
    const row = await updateRow(tx as unknown as Db, contentDrafts, draft.id, { status, scheduledAt: null, updatedAt: new Date() });
    await logActivity(tx as unknown as Db, { ownerId, draftId, type: 'unscheduled', message: `Scheduling cancelled for "${draft.title}"` });
    return row;
  });
}

export async function reschedule(db: Db, input: { ownerId: string; draftId: string; runAt: Date; timezone: string; now?: Date }) {
  const draft = await ownedDraft(db, input.ownerId, input.draftId);
  if (draft.status !== 'scheduled') throw new WorkflowError('Only a scheduled post can be rescheduled.');
  if (input.runAt.getTime() < (input.now ?? new Date()).getTime() + 60_000) throw new WorkflowError('Choose a time at least one minute from now.', 'time_in_past');
  return db.transaction(async (tx) => {
    // updated_at always changes, so a moved job always counts as an affected row.
    const moved = affectedRows(await tx.update(publishingJobs).set({ runAt: input.runAt, updatedAt: new Date() })
      .where(and(eq(publishingJobs.draftId, draft.id), eq(publishingJobs.status, 'queued'))));
    if (!moved) throw new WorkflowError('The post is already being published.', 'job_running');
    const row = await updateRow(tx as unknown as Db, contentDrafts, draft.id, { scheduledAt: input.runAt, timezone: input.timezone, updatedAt: new Date() });
    await logActivity(tx as unknown as Db, { ownerId: input.ownerId, draftId: draft.id, type: 'rescheduled', message: `"${draft.title}" moved to ${input.runAt.toISOString()} (${input.timezone})` });
    return row;
  });
}

export async function archiveDraft(db: Db, ownerId: string, draftId: string) {
  const draft = await ownedDraft(db, ownerId, draftId);
  const status = nextStatus(draft.status as DraftStatus, 'archive');
  return updateRow(db, contentDrafts, draft.id, { status, updatedAt: new Date() });
}

export async function getDraftDetail(db: Db, ownerId: string, draftId: string) {
  const draft = await ownedDraft(db, ownerId, draftId);
  const [versions, approvalRows, jobs, logs] = await Promise.all([
    db.select().from(contentVersions).where(eq(contentVersions.draftId, draft.id)).orderBy(desc(contentVersions.version)),
    db.select().from(approvals).where(eq(approvals.draftId, draft.id)).orderBy(desc(approvals.createdAt)),
    db.select().from(publishingJobs).where(eq(publishingJobs.draftId, draft.id)).orderBy(desc(publishingJobs.createdAt)),
    db.select().from(publishLogs).where(eq(publishLogs.draftId, draft.id)).orderBy(asc(publishLogs.createdAt)),
  ]);
  return { draft, versions, approvals: approvalRows, jobs, logs, current: versions.find((v) => v.id === draft.currentVersionId) ?? null };
}

export async function listDrafts(db: Db, ownerId: string, statuses?: DraftStatus[]) {
  const where = statuses?.length ? and(eq(contentDrafts.ownerId, ownerId), inArray(contentDrafts.status, statuses)) : eq(contentDrafts.ownerId, ownerId);
  return db.select().from(contentDrafts).where(where).orderBy(desc(contentDrafts.updatedAt)).limit(200);
}

export async function draftCounts(db: Db, ownerId: string): Promise<Record<string, number>> {
  const rows = await db.select({ status: contentDrafts.status, n: count() }).from(contentDrafts).where(eq(contentDrafts.ownerId, ownerId)).groupBy(contentDrafts.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function failedJobCount(db: Db, ownerId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(publishingJobs).where(and(eq(publishingJobs.ownerId, ownerId), eq(publishingJobs.status, 'failed')));
  return Number(row?.n ?? 0);
}
