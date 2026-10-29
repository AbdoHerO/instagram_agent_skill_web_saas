'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { ActionState } from '@/components/forms';
import { isValidTimeZone, zonedToUtc } from '@/lib/time';
import { generateDraft, GenerationError } from '@/server/ai/generate';
import { generateDeps, mediaStorage, metaConfig } from '@/server/app';
import { requireUser } from '@/server/auth/session';
import { getBrand } from '@/server/brand';
import { searchProducts, toFact } from '@/server/catalog/client';
import {
  approveDraft, archiveDraft, cancelSchedule, createDraft, editDraft, getDraftDetail, NotFoundError, rejectDraft, reschedule, scheduleDraft, submitForApproval,
} from '@/server/content/service';
import { contentPayloadSchema, type ContentPayload, type VersionValidation } from '@/server/content/types';
import { WorkflowError } from '@/server/content/workflow';
import { getDb } from '@/server/db';
import { brandProfiles, instagramAccounts } from '@/server/db/schema';
import { env } from '@/server/env';
import { MediaError, saveUpload } from '@/server/media/service';
import { accountToken, checkAccount, disconnectAccount } from '@/server/meta/accounts';
import { MetaApiError } from '@/server/meta/graph';
import { mediaInsights, type InsightsResult } from '@/server/meta/insights';
import { pythonToolRunner, runSkillChecks } from '@/server/skills/tools';

/** Known errors become messages; anything else is logged (without secrets) and hidden. */
async function attempt(work: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WorkflowError || error instanceof NotFoundError || error instanceof GenerationError || error instanceof MediaError || error instanceof MetaApiError) {
      return { error: error.message };
    }
    if (error instanceof z.ZodError) return { error: error.issues.map((i) => i.message).join('; ') };
    console.error('[action]', error instanceof Error ? error.name : 'error');
    return { error: 'Something went wrong. Nothing was published.' };
  }
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '');
const lines = (value: string) => value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const pairs = (value: string, n: number) => lines(value).map((line) => {
  const parts = line.split('|').map((p) => p.trim());
  return Array.from({ length: n }, (_, i) => parts[i] ?? '');
});

export async function generateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let draftId: string | null = null;
  const result = await attempt(async () => {
    const productIds = str(fd, 'productIds').split(/[\s,]+/).filter(Boolean).map(Number);
    const { draft } = await generateDraft(generateDeps(), {
      ownerId: user.id, userId: user.id,
      request: {
        kind: str(fd, 'kind'), purpose: str(fd, 'purpose') || 'general', topic: str(fd, 'topic'), language: str(fd, 'language') || 'fr',
        productIds, sourceMaterial: str(fd, 'sourceMaterial'), keywords: str(fd, 'keywords'), extraInstructions: str(fd, 'extraInstructions'),
      },
    });
    draftId = draft.id;
    return { ok: true };
  });
  if (draftId) redirect(`/drafts/${draftId}`);
  return result;
}

/** A draft written by hand (no AI): same approval and scheduling rules. */
export async function createBlankDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let draftId: string | null = null;
  const result = await attempt(async () => {
    const input = z.object({ kind: z.enum(['reel', 'feed_image', 'carousel', 'story', 'plan', 'idea']), title: z.string().trim().min(2, 'Give the post a title').max(200), language: z.enum(['fr', 'ar', 'en']) })
      .parse({ kind: str(fd, 'kind'), title: str(fd, 'title'), language: str(fd, 'language') || 'fr' });
    const db = getDb();
    const brand = await getBrand(db, user.id);
    const { draft } = await createDraft(db, { ownerId: user.id, userId: user.id, kind: input.kind, title: input.title, payload: contentPayloadSchema.parse({ language: input.language }), timezone: brand.timezone });
    draftId = draft.id;
    return { ok: true };
  });
  if (draftId) redirect(`/drafts/${draftId}`);
  return result;
}

export async function searchProductsAction(query: string) {
  await requireUser();
  const e = env();
  try {
    const products = await searchProducts({ baseUrl: e.ECOMMERCE_API_URL }, query.slice(0, 100), 12);
    return { products: products.map((p) => toFact(p, e.STOREFRONT_PUBLIC_URL)), error: null };
  } catch (error) {
    return { products: [], error: error instanceof Error ? error.message : 'Catalogue unavailable' };
  }
}

/** A manual edit: a new immutable version (approval invalidated if there was one). */
export async function saveVersionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const draftId = z.uuid().parse(str(fd, 'draftId'));
    const db = getDb();
    const detail = await getDraftDetail(db, user.id, draftId);
    const previous = contentPayloadSchema.parse(detail.current?.payload ?? {});
    const payload: ContentPayload = {
      ...previous,
      language: (['fr', 'ar', 'en'].includes(str(fd, 'language')) ? str(fd, 'language') : previous.language) as ContentPayload['language'],
      caption: str(fd, 'caption').slice(0, 2200),
      cta: str(fd, 'cta').slice(0, 300),
      hashtags: [...new Set(str(fd, 'hashtags').split(/[\s,]+/).filter(Boolean).map((t) => `#${t.replace(/^#+/, '')}`))],
      altText: str(fd, 'altText').slice(0, 1000),
      notes: str(fd, 'notes').slice(0, 4000),
      hooks: lines(str(fd, 'hooks')).map((text, i) => ({ text, formula: previous.hooks[i]?.text === text ? previous.hooks[i]!.formula : 'edited' })),
      script: pairs(str(fd, 'script'), 2).map(([line, onScreen]) => ({ line: line!, onScreen: onScreen! })),
      slides: pairs(str(fd, 'slides'), 2).map(([heading, body]) => ({ heading: heading!, body: body! })),
      storyFrames: pairs(str(fd, 'storyFrames'), 2).map(([text, sticker]) => ({ text: text!, sticker: sticker! })),
      plan: pairs(str(fd, 'plan'), 4).map(([day, format, idea, time]) => ({ day: day!, format: format!, idea: idea!, time: time! })),
      needsVerification: lines(str(fd, 'needsVerification')).map((line) => {
        const [field, ...rest] = line.split(':');
        return { field: field!.trim(), reason: rest.join(':').trim() || 'to confirm' };
      }),
    };
    // The skills' checks run on manual edits too (report only: the text stays as written).
    const tools = await runSkillChecks(pythonToolRunner(env().PYTHON_BIN), {
      caption: payload.caption, hashtags: payload.hashtags, hooks: payload.hooks.map((h) => h.text), scriptLines: payload.script.map((s) => s.line), keywords: [],
    });
    delete tools.humanized;
    await editDraft(db, { ownerId: user.id, userId: user.id, draftId, title: str(fd, 'title') || undefined, payload, tools: tools as unknown as Record<string, unknown> });
    revalidatePath(`/drafts/${draftId}`);
    return { ok: true, message: 'Saved as a new version. It needs approval before it can be scheduled.' };
  });
}

export async function uploadMediaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const draftId = z.uuid().parse(str(fd, 'draftId'));
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose a JPEG image or an MP4 video.' };
    const db = getDb();
    const detail = await getDraftDetail(db, user.id, draftId);
    const asset = await saveUpload(db, mediaStorage(), { ownerId: user.id, data: Buffer.from(await file.arrayBuffer()), originalName: file.name, maxBytes: env().MEDIA_MAX_BYTES });
    // Same text, new media: the previous version's skill checks still apply.
    const tools = (detail.current?.validation as VersionValidation | undefined)?.tools;
    await editDraft(db, { ownerId: user.id, userId: user.id, draftId, payload: contentPayloadSchema.parse(detail.current?.payload ?? {}), mediaAssetId: asset.id, tools });
    revalidatePath(`/drafts/${draftId}`);
    return { ok: true, message: 'Media attached in a new version. Approve it before scheduling.' };
  });
}

const idSchema = z.object({ draftId: z.uuid() });

export async function submitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const { draftId } = idSchema.parse({ draftId: str(fd, 'draftId') });
    await submitForApproval(getDb(), user.id, draftId);
    revalidatePath(`/drafts/${draftId}`);
    return { ok: true, message: 'Sent for approval.' };
  });
}

export async function approveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const input = z.object({ draftId: z.uuid(), versionId: z.uuid(), note: z.string().max(500) }).parse({ draftId: str(fd, 'draftId'), versionId: str(fd, 'versionId'), note: str(fd, 'note') });
    await approveDraft(getDb(), { ownerId: user.id, userId: user.id, ...input, note: input.note || undefined });
    revalidatePath(`/drafts/${input.draftId}`);
    revalidatePath('/approvals');
    return { ok: true, message: 'Approved. You can now schedule this exact version.' };
  });
}

export async function rejectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const input = z.object({ draftId: z.uuid(), note: z.string().max(500) }).parse({ draftId: str(fd, 'draftId'), note: str(fd, 'note') });
    await rejectDraft(getDb(), { ownerId: user.id, userId: user.id, draftId: input.draftId, note: input.note || undefined });
    revalidatePath(`/drafts/${input.draftId}`);
    revalidatePath('/approvals');
    return { ok: true, message: 'Rejected.' };
  });
}

const whenSchema = z.object({ draftId: z.uuid(), date: z.string(), time: z.string(), timezone: z.string().refine(isValidTimeZone, 'Unknown time zone') });

export async function scheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const input = whenSchema.extend({ accountId: z.uuid('Choose the Instagram account') }).parse({
      draftId: str(fd, 'draftId'), date: str(fd, 'date'), time: str(fd, 'time'), timezone: str(fd, 'timezone'), accountId: str(fd, 'accountId'),
    });
    const runAt = zonedToUtc(input.date, input.time, input.timezone);
    await scheduleDraft(getDb(), { ownerId: user.id, draftId: input.draftId, runAt, timezone: input.timezone, instagramAccountId: input.accountId });
    revalidatePath(`/drafts/${input.draftId}`);
    revalidatePath('/calendar');
    return { ok: true, message: 'Scheduled. The worker publishes it at that time if publishing is enabled.' };
  });
}

export async function rescheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const input = whenSchema.parse({ draftId: str(fd, 'draftId'), date: str(fd, 'date'), time: str(fd, 'time'), timezone: str(fd, 'timezone') });
    await reschedule(getDb(), { ownerId: user.id, draftId: input.draftId, runAt: zonedToUtc(input.date, input.time, input.timezone), timezone: input.timezone });
    revalidatePath(`/drafts/${input.draftId}`);
    revalidatePath('/calendar');
    return { ok: true, message: 'Rescheduled.' };
  });
}

export async function cancelScheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const { draftId } = idSchema.parse({ draftId: str(fd, 'draftId') });
    await cancelSchedule(getDb(), user.id, draftId);
    revalidatePath(`/drafts/${draftId}`);
    revalidatePath('/calendar');
    return { ok: true, message: 'Scheduling cancelled. The post stays approved.' };
  });
}

export async function archiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const { draftId } = idSchema.parse({ draftId: str(fd, 'draftId') });
    await archiveDraft(getDb(), user.id, draftId);
    revalidatePath(`/drafts/${draftId}`);
    return { ok: true, message: 'Archived.' };
  });
}

export async function settingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const input = z.object({
      voiceMarkdown: z.string().max(20_000),
      defaultLanguage: z.enum(['fr', 'ar', 'en']),
      timezone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
      defaultPostTime: z.string().regex(/^\d{2}:\d{2}$/),
      aiRetentionDays: z.coerce.number().int().min(30).max(730),
      publishingEnabled: z.boolean(),
    }).parse({
      voiceMarkdown: str(fd, 'voiceMarkdown'), defaultLanguage: str(fd, 'defaultLanguage'), timezone: str(fd, 'timezone'), defaultPostTime: str(fd, 'defaultPostTime'),
      aiRetentionDays: str(fd, 'aiRetentionDays'), publishingEnabled: fd.get('publishingEnabled') === 'on',
    });
    if (input.publishingEnabled && str(fd, 'publishingConfirm') !== 'PUBLISH') {
      return { error: 'To enable publishing, type PUBLISH in the confirmation field.' };
    }
    const db = getDb();
    await getBrand(db, user.id);
    await db.update(brandProfiles).set({ ...input, updatedAt: new Date() }).where(eq(brandProfiles.ownerId, user.id));
    revalidatePath('/settings');
    return { ok: true, message: input.publishingEnabled ? 'Saved. Publishing is enabled for approved, scheduled posts.' : 'Saved. Publishing stays off.' };
  });
}

export async function checkAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const accountId = z.uuid().parse(str(fd, 'accountId'));
    const db = getDb();
    const [account] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, accountId));
    if (!account || account.ownerId !== user.id) throw new NotFoundError('Account not found');
    const result = await checkAccount(db, metaConfig(), account, env().TOKEN_ENCRYPTION_KEY);
    revalidatePath('/accounts');
    return result.ok ? { ok: true, message: 'Connection verified: access valid and permissions granted.' } : { error: result.problems.join(' ') };
  });
}

export async function disconnectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return attempt(async () => {
    const accountId = z.uuid().parse(str(fd, 'accountId'));
    const row = await disconnectAccount(getDb(), user.id, accountId);
    if (!row) throw new NotFoundError('Account not found');
    revalidatePath('/accounts');
    return { ok: true, message: 'Disconnected here. To revoke it on Meta, remove the app in Business Settings > Integrations > Connected apps.' };
  });
}

export async function mediaInsightsAction(draftId: string): Promise<{ result: InsightsResult | null; error: string | null }> {
  const user = await requireUser();
  try {
    const db = getDb();
    const detail = await getDraftDetail(db, user.id, z.uuid().parse(draftId));
    if (!detail.draft.publishedMediaId || !detail.draft.instagramAccountId) return { result: null, error: 'Not published through this app.' };
    const [account] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, detail.draft.instagramAccountId));
    if (!account || account.ownerId !== user.id) return { result: null, error: 'Account not found.' };
    const token = accountToken(account, env().TOKEN_ENCRYPTION_KEY);
    return { result: await mediaInsights(metaConfig(), token, detail.draft.publishedMediaId, detail.draft.kind === 'reel' ? 'reel' : 'feed_image'), error: null };
  } catch (error) {
    return { result: null, error: error instanceof MetaApiError ? error.message : 'Insights unavailable.' };
  }
}
