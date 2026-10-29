import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  approveDraft, cancelSchedule, createDraft, editDraft, getDraftDetail, NotFoundError, rejectDraft, reschedule, scheduleDraft, submitForApproval,
} from '@/server/content/service';
import { validateContent } from '@/server/content/validate';
import { canDo, nextStatus, WorkflowError } from '@/server/content/workflow';
import type { Db } from '@/server/db';
import { publishingJobs } from '@/server/db/schema';

import { createTestDb } from './helpers/db';
import { createAccount, createMedia, createUser, payload } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

const inOneHour = () => new Date(Date.now() + 3_600_000);

describe('workflow state machine', () => {
  it('never reaches scheduled without approval, and an edit always falls back to draft', () => {
    expect(() => nextStatus('draft', 'schedule')).toThrow(WorkflowError);
    expect(() => nextStatus('awaiting_approval', 'schedule')).toThrow(WorkflowError);
    expect(nextStatus('approved', 'schedule')).toBe('scheduled');
    expect(nextStatus('approved', 'edit')).toBe('draft');
    expect(nextStatus('scheduled', 'edit')).toBe('draft');
    expect(canDo('publishing', 'edit')).toBe(false);
    expect(canDo('published', 'edit')).toBe(false);
    expect(() => nextStatus('draft', 'start_publishing')).toThrow(WorkflowError);
  });
});

describe('content validation', () => {
  it('blocks placeholders, invented prices and discounts, too many hashtags', () => {
    const issues = validateContent('feed_image', payload({
      caption: 'ThinkPad à 3 990 MAD, -20 % cette semaine. Garantie {{durée}}.',
      hashtags: ['#a', '#b', '#c', '#d', '#e', '#f'],
    }), true);
    const codes = issues.filter((i) => i.blocking).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['placeholder', 'unverified_price', 'unverified_discount', 'hashtags']));
  });

  it('accepts a price and a saving that come from the product data', () => {
    const issues = validateContent('feed_image', payload({
      caption: 'HP EliteBook 840 G6 : 4 788 MAD au lieu de 5 988 MAD, soit -20 %.',
      productFacts: [{ productId: 7, name: 'HP EliteBook 840 G6', sku: 'HP-1', priceTtc: 4788, compareAtTtc: 5988, inStock: true, condition: null, warrantyMonths: null, url: null, fetchedAt: new Date().toISOString() }],
    }), true);
    expect(issues.filter((i) => i.blocking)).toEqual([]);
  });
});

describe('drafts, approval and scheduling', () => {
  it('saves every new post as a draft and approves only the current, clean version', async () => {
    const owner = await createUser(db);
    const { draft, version } = await createDraft(db, { ownerId: owner.id, userId: owner.id, kind: 'feed_image', title: 'Conseils achat', payload: payload() });
    expect(draft.status).toBe('draft');
    expect(version.version).toBe(1);

    const blocked = await createDraft(db, { ownerId: owner.id, userId: owner.id, kind: 'feed_image', title: 'Prix', payload: payload({ caption: 'Seulement 2 999 MAD !' }) });
    await expect(approveDraft(db, { ownerId: owner.id, userId: owner.id, draftId: blocked.draft.id, versionId: blocked.version.id })).rejects.toMatchObject({ code: 'blocking_issues' });

    await submitForApproval(db, owner.id, draft.id);
    const approved = await approveDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, versionId: version.id, note: 'OK' });
    expect(approved.status).toBe('approved');
    expect(approved.approvedVersionId).toBe(version.id);
  });

  it('invalidates the approval and cancels the queued job when an approved post is edited', async () => {
    const owner = await createUser(db);
    const account = await createAccount(db, owner.id);
    const media = await createMedia(db, owner.id);
    const { draft, version } = await createDraft(db, { ownerId: owner.id, userId: owner.id, kind: 'feed_image', title: 'Nouveautés', payload: payload(), mediaAssetId: media.id });
    await approveDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, versionId: version.id });
    const { job } = await scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: inOneHour(), timezone: 'Africa/Casablanca', instagramAccountId: account.id });
    expect(job.status).toBe('queued');
    expect(job.idempotencyKey).toBe(`publish:${version.id}`);

    const edited = await editDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, payload: payload({ caption: 'Texte modifié après approbation.' }) });
    expect(edited.draft.status).toBe('draft');
    expect(edited.draft.approvedVersionId).toBeNull();
    expect(edited.version.version).toBe(2);
    const [cancelled] = await db.select().from(publishingJobs).where(eq(publishingJobs.id, job.id));
    expect(cancelled!.status).toBe('cancelled');

    // The old approval does not carry over: the new version must be approved before scheduling.
    await expect(scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: inOneHour(), timezone: 'Africa/Casablanca', instagramAccountId: account.id }))
      .rejects.toBeInstanceOf(WorkflowError);
    const detail = await getDraftDetail(db, owner.id, draft.id);
    expect(detail.approvals.map((a) => a.decision)).toEqual(expect.arrayContaining(['approved', 'invalidated']));
    expect(detail.versions).toHaveLength(2);
  });

  it('schedules once per version, can cancel and reschedule before publishing', async () => {
    const owner = await createUser(db);
    const account = await createAccount(db, owner.id);
    const media = await createMedia(db, owner.id);
    const { draft, version } = await createDraft(db, { ownerId: owner.id, userId: owner.id, kind: 'feed_image', title: 'Promo', payload: payload(), mediaAssetId: media.id });
    await approveDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, versionId: version.id });

    await expect(scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: new Date(Date.now() - 1000), timezone: 'Africa/Casablanca', instagramAccountId: account.id }))
      .rejects.toMatchObject({ code: 'time_in_past' });
    await scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: inOneHour(), timezone: 'Africa/Casablanca', instagramAccountId: account.id });
    await expect(scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: inOneHour(), timezone: 'Africa/Casablanca', instagramAccountId: account.id }))
      .rejects.toBeInstanceOf(WorkflowError); // already scheduled

    const later = new Date(Date.now() + 7_200_000);
    const moved = await reschedule(db, { ownerId: owner.id, draftId: draft.id, runAt: later, timezone: 'Africa/Casablanca' });
    expect(moved.scheduledAt?.getTime()).toBe(later.getTime());

    const back = await cancelSchedule(db, owner.id, draft.id);
    expect(back.status).toBe('approved');
    // Rescheduling after a cancellation creates a new job and keeps the cancelled one as history.
    await scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: inOneHour(), timezone: 'Africa/Casablanca', instagramAccountId: account.id });
    const jobs = await db.select().from(publishingJobs).where(eq(publishingJobs.draftId, draft.id));
    expect(jobs.map((j) => j.status).sort()).toEqual(['cancelled', 'queued']);
  });

  it('refuses a second live job for the same version at the database level', async () => {
    const owner = await createUser(db);
    const account = await createAccount(db, owner.id);
    const media = await createMedia(db, owner.id);
    const { draft, version } = await createDraft(db, { ownerId: owner.id, userId: owner.id, kind: 'reel', title: 'Reel', payload: payload(), mediaAssetId: media.id });
    const values = { ownerId: owner.id, draftId: draft.id, versionId: version.id, instagramAccountId: account.id, runAt: inOneHour(), idempotencyKey: `publish:${version.id}` };
    await db.insert(publishingJobs).values({ ...values, status: 'succeeded' });
    await expect(db.insert(publishingJobs).values({ ...values, status: 'queued' })).rejects.toThrow();
  });

  it('keeps each owner to their own drafts and accounts', async () => {
    const owner = await createUser(db);
    const stranger = await createUser(db);
    const strangerAccount = await createAccount(db, stranger.id);
    const media = await createMedia(db, owner.id);
    const { draft, version } = await createDraft(db, { ownerId: owner.id, userId: owner.id, kind: 'feed_image', title: 'Privé', payload: payload(), mediaAssetId: media.id });

    await expect(getDraftDetail(db, stranger.id, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(approveDraft(db, { ownerId: stranger.id, userId: stranger.id, draftId: draft.id, versionId: version.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createDraft(db, { ownerId: stranger.id, userId: stranger.id, kind: 'feed_image', title: 'x', payload: payload(), mediaAssetId: media.id })).rejects.toBeInstanceOf(NotFoundError);

    await approveDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, versionId: version.id });
    await expect(scheduleDraft(db, { ownerId: owner.id, draftId: draft.id, runAt: inOneHour(), timezone: 'Africa/Casablanca', instagramAccountId: strangerAccount.id }))
      .rejects.toBeInstanceOf(NotFoundError);
    await rejectDraft(db, { ownerId: owner.id, userId: owner.id, draftId: draft.id, note: 'Pas maintenant' });
  });
});
