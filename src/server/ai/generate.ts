import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { and, asc, count, desc, eq, gte, lt, or, sql } from 'drizzle-orm';

import { factsFor, type CatalogConfig } from '@/server/catalog/client';
import { completeGeneratedDraft, createGeneratingDraft, failGeneratedDraft, getDraftDetail, markDraftGenerating, NotFoundError } from '@/server/content/service';
import type { ContentPayload } from '@/server/content/types';
import { WorkflowError } from '@/server/content/workflow';
import { insertRow, type Db } from '@/server/db';
import { aiGenerations, brandProfiles, contentDrafts } from '@/server/db/schema';
import { pruneAiGenerations } from '@/server/retention';
import { runSkillChecks, type ToolRunner } from '@/server/skills/tools';
import { loadVoiceFile, skillsFor } from '@/server/skills/registry';

import { buildSystemPrompt, buildUserMessage } from './prompt';
import { generatedContentSchema, generationRequestSchema, type GeneratedContent, type GenerationRequest } from './schema';

/**
 * The AI service: request in, validated draft out. Separate from the web UI and
 * from publishing (it never schedules or posts). It runs in two steps, so a web
 * request never waits for Claude (Nginx closes a silent request after 60 s):
 *
 *   queueGeneration (in the request): validate, check the daily limit, create
 *   the draft as "generating" and queue the request -> returns at once;
 *   processGeneration (in the worker): load business context, voice and skill
 *   instructions -> fetch verified product facts -> ask Claude for structured
 *   output -> clean and score it with the skills' tools -> version 1 of the
 *   draft, for human review.
 */
export type MessagesClient = Pick<Anthropic, 'beta'>;

export type GenerateDeps = {
  db: Db;
  client: MessagesClient | null;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  dailyLimit: number;
  catalog: CatalogConfig;
  businessContext: string;
  runTool: ToolRunner;
};

export class GenerationError extends Error {
  constructor(message: string, readonly code: 'invalid_request' | 'not_configured' | 'limit_reached' | 'refused' | 'invalid_output' | 'api_error' | 'rate_limited' | 'interrupted') {
    super(message);
  }
}

/** A generation left "running" this long (its worker stopped) is claimed again, at most this many times in all. */
export const GENERATION_LOCK_MINUTES = 10;
const MAX_ATTEMPTS = 3;

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Every request counts, queued ones included, so the queue cannot be used to pass the limit. */
export async function generationsToday(db: Db, ownerId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(aiGenerations).where(and(eq(aiGenerations.ownerId, ownerId), gte(aiGenerations.createdAt, startOfUtcDay())));
  return Number(row?.n ?? 0);
}

const normaliseTag = (tag: string) => {
  const clean = tag.trim().replace(/^#+/, '').replace(/\s+/g, '');
  return clean ? `#${clean}` : '';
};

const forLog = (request: GenerationRequest) => ({ ...request, sourceMaterial: request.sourceMaterial ? `[${request.sourceMaterial.length} characters]` : '' });

/** Step 1, in the web request: the draft exists at once (status "generating"); the worker writes it. */
export async function queueGeneration(deps: Pick<GenerateDeps, 'db' | 'client' | 'dailyLimit' | 'model'>, input: { ownerId: string; userId: string; request: unknown }) {
  const parsed = generationRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new GenerationError(parsed.error.issues.map((i) => i.message).join('; '), 'invalid_request');
  const request: GenerationRequest = parsed.data;
  if (!deps.client) throw new GenerationError('Claude is not configured: set ANTHROPIC_API_KEY on the server.', 'not_configured');
  if ((await generationsToday(deps.db, input.ownerId)) >= deps.dailyLimit) {
    throw new GenerationError(`Daily generation limit reached (${deps.dailyLimit}). It resets at midnight UTC.`, 'limit_reached');
  }
  const [brand] = await deps.db.select({ timezone: brandProfiles.timezone }).from(brandProfiles).where(eq(brandProfiles.ownerId, input.ownerId));
  const draft = await createGeneratingDraft(deps.db, { ownerId: input.ownerId, kind: request.kind, title: request.topic, timezone: brand?.timezone });
  const generation = await insertRow(deps.db, aiGenerations, {
    ownerId: input.ownerId, requestedBy: input.userId, draftId: draft.id, request, model: deps.model, skills: skillsFor(request.kind, request.purpose), status: 'queued',
  });
  return { draft, generationId: generation.id };
}

/** "Try again" on a draft whose generation failed: the same request, queued again. */
export async function retryGeneration(deps: Pick<GenerateDeps, 'db' | 'client' | 'dailyLimit' | 'model'>, input: { ownerId: string; userId: string; draftId: string }) {
  if (!deps.client) throw new GenerationError('Claude is not configured: set ANTHROPIC_API_KEY on the server.', 'not_configured');
  const [previous] = await deps.db.select().from(aiGenerations)
    .where(and(eq(aiGenerations.ownerId, input.ownerId), eq(aiGenerations.draftId, input.draftId))).orderBy(desc(aiGenerations.createdAt)).limit(1);
  if (!previous) throw new NotFoundError('No generation request for this draft');
  const request = generationRequestSchema.safeParse(previous.request);
  if (!request.success || request.data.sourceMaterial.startsWith('[')) {
    throw new WorkflowError('The original request is no longer complete: write the draft again from the AI Content Studio.', 'request_unavailable');
  }
  if ((await generationsToday(deps.db, input.ownerId)) >= deps.dailyLimit) {
    throw new GenerationError(`Daily generation limit reached (${deps.dailyLimit}). It resets at midnight UTC.`, 'limit_reached');
  }
  await markDraftGenerating(deps.db, input.ownerId, input.draftId);
  return insertRow(deps.db, aiGenerations, {
    ownerId: input.ownerId, requestedBy: input.userId, draftId: input.draftId, request: request.data, model: deps.model, skills: previous.skills, status: 'queued',
  });
}

/**
 * The worker takes the oldest queued request with one atomic UPDATE (two
 * workers never take the same one, e.g. the old and new release during a
 * deployment); one left running by a stopped worker is taken back after
 * GENERATION_LOCK_MINUTES.
 */
export async function claimGeneration(db: Db, workerId: string, now = new Date(), onlyId?: string) {
  const staleBefore = new Date(now.getTime() - GENERATION_LOCK_MINUTES * 60_000);
  const claimable = or(eq(aiGenerations.status, 'queued'), and(eq(aiGenerations.status, 'running'), lt(aiGenerations.lockedAt, staleBefore)));
  await db.update(aiGenerations)
    .set({ status: 'running', lockedAt: now, lockedBy: workerId, attempts: sql`${aiGenerations.attempts} + 1` })
    .where(onlyId ? and(claimable, eq(aiGenerations.id, onlyId)) : claimable)
    .orderBy(asc(aiGenerations.createdAt))
    .limit(1);
  const [row] = await db.select().from(aiGenerations)
    .where(and(eq(aiGenerations.lockedBy, workerId), eq(aiGenerations.lockedAt, now), eq(aiGenerations.status, 'running')));
  return row ?? null;
}

export type GenerationOutcome =
  | { status: 'succeeded'; draftId: string }
  | { status: 'failed'; draftId: string | null; error: GenerationError }
  | { status: 'requeued' }
  | { status: 'skipped'; reason: string };

/** Step 2, in the worker. `signal` aborts the wait for Claude (worker stopping): the request goes back to the queue. */
export async function processGeneration(deps: GenerateDeps, generationId: string, signal?: AbortSignal): Promise<GenerationOutcome> {
  const db = deps.db;
  const [generation] = await db.select().from(aiGenerations).where(eq(aiGenerations.id, generationId));
  if (!generation || generation.status !== 'running') return { status: 'skipped', reason: 'not running' };
  const ownerId = generation.ownerId;
  const draftId = generation.draftId;
  const started = Date.now();
  const finish = (values: Partial<typeof aiGenerations.$inferInsert>) =>
    db.update(aiGenerations).set({ ...values, lockedAt: null, lockedBy: null, durationMs: Date.now() - started }).where(eq(aiGenerations.id, generationId));
  const fail = async (error: GenerationError, extra: Partial<typeof aiGenerations.$inferInsert> = {}): Promise<GenerationOutcome> => {
    const status = error.code === 'refused' ? 'refused' : error.code === 'invalid_output' ? 'invalid' : 'failed';
    await finish({ status, error: error.message, ...extra });
    if (draftId) await failGeneratedDraft(db, ownerId, draftId, error.message).catch(() => null);
    return { status: 'failed', draftId, error };
  };

  const [draft] = draftId ? await db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)) : [];
  if (!draft || draft.status !== 'generating') {
    await finish({ status: 'failed', error: 'The draft was archived or removed before it was written.' });
    return { status: 'skipped', reason: 'draft no longer generating' };
  }
  if (generation.attempts > MAX_ATTEMPTS) return fail(new GenerationError('The generation was interrupted too many times. Try again.', 'interrupted'));
  const parsed = generationRequestSchema.safeParse(generation.request);
  if (!parsed.success) return fail(new GenerationError('The saved request is invalid.', 'invalid_request'));
  const request = parsed.data;
  if (!deps.client) return fail(new GenerationError('Claude is not configured: set ANTHROPIC_API_KEY on the server.', 'not_configured'));

  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.ownerId, ownerId));
  const voice = brand?.voiceMarkdown?.trim() || loadVoiceFile();
  const skills = skillsFor(request.kind, request.purpose);
  const { facts, missing } = request.productIds.length ? await factsFor(deps.catalog, request.productIds) : { facts: [], missing: [] };

  const requeue = async (): Promise<GenerationOutcome> => {
    // The worker is stopping (e.g. a deployment): another worker takes it from the start.
    await db.update(aiGenerations).set({ status: 'queued', lockedAt: null, lockedBy: null }).where(eq(aiGenerations.id, generationId));
    return { status: 'requeued' };
  };
  if (signal?.aborted) return requeue();

  let content: GeneratedContent;
  let usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null } = {};
  let stopReason: string | null = null;
  try {
    const response = await deps.client.beta.messages.parse({
      model: deps.model,
      max_tokens: 16_000,
      // Server-side fallback: if the model declines, the API re-runs the request on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: buildSystemPrompt({ businessContext: deps.businessContext, voice, skills }), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(request, facts, missing) }],
      output_config: { format: betaZodOutputFormat(generatedContentSchema), effort: deps.effort },
    }, { signal });
    usage = response.usage;
    stopReason = response.stop_reason;
    const tokens = { stopReason, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? null };
    if (response.stop_reason === 'refusal') return fail(new GenerationError('Claude declined this request. Rephrase the brief.', 'refused'), tokens);
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      return fail(new GenerationError('The answer was incomplete. Try again with a shorter brief.', 'invalid_output'), tokens);
    }
    content = generatedContentSchema.parse(response.parsed_output);
  } catch (error) {
    if (signal?.aborted) return requeue();
    const message = error instanceof Anthropic.RateLimitError ? 'Claude is rate limited; try again in a minute.'
      : error instanceof Anthropic.AuthenticationError ? 'The Anthropic API key was refused.'
      : error instanceof Anthropic.BadRequestError ? 'Claude rejected the request.'
      : error instanceof Anthropic.APIConnectionError ? 'Could not reach Claude.'
      : error instanceof Anthropic.APIError ? `Claude API error (${error.status ?? 'unknown'}).`
      : 'Content generation failed.';
    return fail(new GenerationError(message, error instanceof Anthropic.RateLimitError ? 'rate_limited' : 'api_error'));
  }

  // The skills' own checks: clean the caption, lint it, score hooks and timing.
  const hashtags = [...new Set(content.hashtags.map(normaliseTag).filter(Boolean))];
  const checks = await runSkillChecks(deps.runTool, {
    caption: content.caption,
    hashtags,
    hooks: content.hooks.map((h) => h.text).filter(Boolean),
    scriptLines: content.script.map((s) => s.line).filter(Boolean),
    keywords: request.keywords.split(',').map((k) => k.trim()).filter(Boolean),
  });
  const payload: ContentPayload = {
    language: request.language,
    hooks: content.hooks,
    caption: checks.humanized?.text?.trimEnd() || content.caption,
    cta: content.cta,
    hashtags,
    altText: content.altText,
    script: content.script,
    slides: content.slides,
    storyFrames: content.storyFrames,
    plan: content.plan,
    notes: content.notes,
    needsVerification: [
      ...content.needsVerification,
      ...missing.map((id) => ({ field: `product ${id}`, reason: 'Could not be loaded from the catalogue API' })),
    ],
    productFacts: facts,
  };
  try {
    await completeGeneratedDraft(db, {
      ownerId, userId: generation.requestedBy ?? ownerId, draftId: draft.id, title: content.title || request.topic, payload,
      tools: checks as unknown as Record<string, unknown>,
    });
  } catch (error) {
    if (error instanceof WorkflowError || error instanceof NotFoundError) {
      await finish({ status: 'failed', error: 'The draft was archived or removed before it was written.' });
      return { status: 'skipped', reason: 'draft changed meanwhile' };
    }
    throw error;
  }
  await finish({
    status: 'succeeded', request: forLog(request), stopReason,
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? null,
  });
  await pruneAiGenerations(db, ownerId);
  return { status: 'succeeded', draftId: draft.id };
}

/** The latest generation request of a draft (for its "being written" page). */
export async function latestGeneration(db: Db, ownerId: string, draftId: string) {
  const [row] = await db.select({ status: aiGenerations.status, createdAt: aiGenerations.createdAt, lockedAt: aiGenerations.lockedAt, attempts: aiGenerations.attempts, error: aiGenerations.error })
    .from(aiGenerations).where(and(eq(aiGenerations.ownerId, ownerId), eq(aiGenerations.draftId, draftId))).orderBy(desc(aiGenerations.createdAt)).limit(1);
  return row ?? null;
}

/** Both steps at once (tests and scripts): returns the finished draft or throws the generation's error. */
export async function generateDraft(deps: GenerateDeps, input: { ownerId: string; userId: string; request: unknown }) {
  const { draft, generationId } = await queueGeneration(deps, input);
  const claimed = await claimGeneration(deps.db, `inline:${generationId}`, new Date(), generationId);
  if (!claimed) throw new GenerationError('The request could not be claimed.', 'api_error');
  const outcome = await processGeneration(deps, claimed.id);
  if (outcome.status === 'failed') throw outcome.error;
  if (outcome.status !== 'succeeded') throw new GenerationError(`Generation ${outcome.status}.`, 'api_error');
  const detail = await getDraftDetail(deps.db, input.ownerId, draft.id);
  return { draft: detail.draft, version: detail.current! };
}
