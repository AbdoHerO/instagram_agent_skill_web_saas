import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { and, count, eq, gte } from 'drizzle-orm';

import { factsFor, type CatalogConfig } from '@/server/catalog/client';
import { createDraft } from '@/server/content/service';
import type { ContentPayload } from '@/server/content/types';
import type { DraftKind } from '@/server/content/workflow';
import type { Db } from '@/server/db';
import { aiGenerations, brandProfiles } from '@/server/db/schema';
import { pruneAiGenerations } from '@/server/retention';
import { runSkillChecks, type ToolRunner } from '@/server/skills/tools';
import { loadVoiceFile, skillsFor } from '@/server/skills/registry';

import { buildSystemPrompt, buildUserMessage } from './prompt';
import { generatedContentSchema, generationRequestSchema, type GeneratedContent, type GenerationRequest } from './schema';

/**
 * The AI service: request in, validated draft out. Separate from the web UI
 * (called by a server action) and from publishing (it never schedules or posts).
 *
 *   validate the request -> enforce the daily limit -> load business context,
 *   voice and skill instructions -> fetch verified product facts -> ask Claude
 *   for structured output -> clean and score it with the skills' tools ->
 *   save it as a DRAFT -> return it for human review.
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
  constructor(message: string, readonly code: 'invalid_request' | 'not_configured' | 'limit_reached' | 'refused' | 'invalid_output' | 'api_error' | 'rate_limited') {
    super(message);
  }
}

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function generationsToday(db: Db, ownerId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(aiGenerations).where(and(eq(aiGenerations.ownerId, ownerId), gte(aiGenerations.createdAt, startOfUtcDay())));
  return Number(row?.n ?? 0);
}

const normaliseTag = (tag: string) => {
  const clean = tag.trim().replace(/^#+/, '').replace(/\s+/g, '');
  return clean ? `#${clean}` : '';
};

export async function generateDraft(deps: GenerateDeps, input: { ownerId: string; userId: string; request: unknown }) {
  const parsed = generationRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new GenerationError(parsed.error.issues.map((i) => i.message).join('; '), 'invalid_request');
  const request: GenerationRequest = parsed.data;
  if (!deps.client) throw new GenerationError('Claude is not configured: set ANTHROPIC_API_KEY on the server.', 'not_configured');
  if ((await generationsToday(deps.db, input.ownerId)) >= deps.dailyLimit) {
    throw new GenerationError(`Daily generation limit reached (${deps.dailyLimit}). It resets at midnight UTC.`, 'limit_reached');
  }

  const [brand] = await deps.db.select().from(brandProfiles).where(eq(brandProfiles.ownerId, input.ownerId));
  const voice = brand?.voiceMarkdown?.trim() || loadVoiceFile();
  const skills = skillsFor(request.kind, request.purpose);
  const { facts, missing } = request.productIds.length ? await factsFor(deps.catalog, request.productIds) : { facts: [], missing: [] };

  const started = Date.now();
  const logBase = { ownerId: input.ownerId, request: { ...request, sourceMaterial: request.sourceMaterial ? `[${request.sourceMaterial.length} characters]` : '' }, model: deps.model, skills };
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
    });
    usage = response.usage;
    stopReason = response.stop_reason;
    if (response.stop_reason === 'refusal') {
      await deps.db.insert(aiGenerations).values({ ...logBase, status: 'refused', stopReason, durationMs: Date.now() - started });
      throw new GenerationError('Claude declined this request. Rephrase the brief.', 'refused');
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      await deps.db.insert(aiGenerations).values({ ...logBase, status: 'invalid', stopReason, durationMs: Date.now() - started, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens });
      throw new GenerationError('The answer was incomplete. Try again with a shorter brief.', 'invalid_output');
    }
    content = generatedContentSchema.parse(response.parsed_output);
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    const message = error instanceof Anthropic.RateLimitError ? 'Claude is rate limited; try again in a minute.'
      : error instanceof Anthropic.AuthenticationError ? 'The Anthropic API key was refused.'
      : error instanceof Anthropic.BadRequestError ? 'Claude rejected the request.'
      : error instanceof Anthropic.APIConnectionError ? 'Could not reach Claude.'
      : error instanceof Anthropic.APIError ? `Claude API error (${error.status ?? 'unknown'}).`
      : 'Content generation failed.';
    await deps.db.insert(aiGenerations).values({ ...logBase, status: 'failed', error: message, durationMs: Date.now() - started });
    throw new GenerationError(message, error instanceof Anthropic.RateLimitError ? 'rate_limited' : 'api_error');
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
  const kind: DraftKind = request.kind;
  const { draft, version } = await createDraft(deps.db, {
    ownerId: input.ownerId, userId: input.userId, kind, title: content.title || request.topic, payload,
    timezone: brand?.timezone ?? 'Africa/Casablanca', tools: checks as unknown as Record<string, unknown>,
  });
  await deps.db.insert(aiGenerations).values({
    ...logBase, draftId: draft.id, status: 'succeeded', stopReason, durationMs: Date.now() - started,
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? null,
  });
  await pruneAiGenerations(deps.db, input.ownerId);
  return { draft, version };
}
