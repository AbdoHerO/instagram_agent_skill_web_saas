import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateDraft, GenerationError, type GenerateDeps, type MessagesClient } from '@/server/ai/generate';
import type { GeneratedContent } from '@/server/ai/schema';
import type { Db } from '@/server/db';
import { aiGenerations, contentVersions } from '@/server/db/schema';
import type { ToolRunner } from '@/server/skills/tools';

import { createTestDb } from './helpers/db';
import { createUser } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

const content = (overrides: Partial<GeneratedContent> = {}): GeneratedContent => ({
  title: 'HP EliteBook 840 G6', hooks: [{ text: 'Ce portable pro coûte moins qu’un neuf d’entrée de gamme', formula: 'Contrarian Flip' }],
  caption: 'HP EliteBook 840 G6 à 4 788 MAD.', cta: 'Commandez sur le site.', hashtags: ['elitebook', '#HP', '#HP'], altText: 'Portable HP posé sur un bureau',
  script: [], slides: [], storyFrames: [], plan: [], notes: 'Photo du produit réel', needsVerification: [], ...overrides,
});

function fakeClient(parse: () => unknown): MessagesClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, beta: { messages: { parse: vi.fn(async (params: unknown) => { calls.push(params); return parse(); }) } } } as unknown as MessagesClient & { calls: unknown[] };
}

const product = { id: 7, name: 'HP EliteBook 840 G6', sku: 'HP-840', price: 3990, compare_at_price: null, tax_rate: 20, in_stock: true, warranty_months: null };
const catalogFetch = vi.fn(async (url: string | URL | Request) => {
  if (String(url).endsWith('/merchant/products/7')) return new Response(JSON.stringify({ data: product }), { status: 200 });
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

const noTools: ToolRunner = async () => null;

function deps(client: MessagesClient | null, overrides: Partial<GenerateDeps> = {}): GenerateDeps {
  return {
    db, client, model: 'claude-opus-5-5', effort: 'medium', dailyLimit: 50, businessContext: 'Euro Digital, Maroc.', runTool: noTools,
    catalog: { baseUrl: 'http://catalog.test/api/v1', fetchImpl: catalogFetch }, ...overrides,
  };
}

const ok = (parsed: GeneratedContent) => ({ stop_reason: 'end_turn', parsed_output: parsed, usage: { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0 } });

describe('AI content generation', () => {
  it('builds the request from verified facts, saves a draft and never publishes', async () => {
    const owner = await createUser(db);
    const client = fakeClient(() => ok(content()));
    const { draft, version } = await generateDraft(deps(client), { ownerId: owner.id, userId: owner.id, request: { kind: 'feed_image', purpose: 'promotion', topic: 'EliteBook 840 G6', productIds: [7] } });

    expect(draft.status).toBe('draft');
    const params = client.calls[0] as { model: string; system: { text: string; cache_control: unknown }[]; messages: { content: string }[]; fallbacks: string };
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.fallbacks).toBe('default');
    expect(params.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.messages[0]!.content).toContain('"priceTtc": 4788'); // 3990 HT + 20 % VAT
    expect(version.hashtags).toEqual(['#elitebook', '#HP']);
    const issues = (version.validation as { issues: { code: string; blocking: boolean }[] }).issues;
    expect(issues.filter((i) => i.blocking).map((i) => i.code)).not.toContain('unverified_price');

    const [log] = await db.select().from(aiGenerations).where(eq(aiGenerations.draftId, draft.id));
    expect(log!.status).toBe('succeeded');
    expect(JSON.stringify(log!.request)).not.toContain('sk-');
  });

  it('flags an invented price and anything the model could not verify', async () => {
    const owner = await createUser(db);
    const client = fakeClient(() => ok(content({ caption: 'Seulement 2 999 MAD, garantie {{to confirm: durée}}.', needsVerification: [{ field: 'warranty', reason: 'Not in product data' }] })));
    const { version } = await generateDraft(deps(client), { ownerId: owner.id, userId: owner.id, request: { kind: 'feed_image', topic: 'Promo', productIds: [7, 99] } });
    const codes = (version.validation as { issues: { code: string; blocking: boolean }[] }).issues.filter((i) => i.blocking).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['unverified_price', 'placeholder', 'needs_verification']));
    const [saved] = await db.select().from(contentVersions).where(eq(contentVersions.id, version.id));
    expect((saved!.payload as { needsVerification: { field: string }[] }).needsVerification.map((n) => n.field)).toContain('product 99');
  });

  it('validates input, enforces the daily limit and reports refusals and API errors', async () => {
    const owner = await createUser(db);
    await expect(generateDraft(deps(fakeClient(() => ok(content()))), { ownerId: owner.id, userId: owner.id, request: { kind: 'tiktok', topic: 'x' } }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    await expect(generateDraft(deps(null), { ownerId: owner.id, userId: owner.id, request: { kind: 'reel', topic: 'Un sujet' } }))
      .rejects.toMatchObject({ code: 'not_configured' });

    const refused = fakeClient(() => ({ stop_reason: 'refusal', parsed_output: null, usage: {} }));
    await expect(generateDraft(deps(refused), { ownerId: owner.id, userId: owner.id, request: { kind: 'reel', topic: 'Un sujet' } })).rejects.toMatchObject({ code: 'refused' });

    const failing = fakeClient(() => { throw new Anthropic.APIConnectionError({ message: 'down' }); });
    await expect(generateDraft(deps(failing), { ownerId: owner.id, userId: owner.id, request: { kind: 'reel', topic: 'Un sujet' } })).rejects.toBeInstanceOf(GenerationError);

    // 2 logged attempts so far today (refused + failed): a limit of 2 stops the next one before calling Claude.
    const counted = fakeClient(() => ok(content()));
    await expect(generateDraft(deps(counted, { dailyLimit: 2 }), { ownerId: owner.id, userId: owner.id, request: { kind: 'reel', topic: 'Un sujet' } }))
      .rejects.toMatchObject({ code: 'limit_reached' });
    expect(counted.calls).toHaveLength(0);
  });
});
