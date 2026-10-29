import Anthropic from '@anthropic-ai/sdk';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { claimGeneration, processGeneration, queueGeneration, retryGeneration, type GenerateDeps, type MessagesClient } from '@/server/ai/generate';
import type { GeneratedContent } from '@/server/ai/schema';
import { archiveDraft } from '@/server/content/service';
import type { Db } from '@/server/db';
import { aiGenerations, contentDrafts } from '@/server/db/schema';
import type { PublishDeps } from '@/server/jobs/publish';
import { startWorker } from '@/server/jobs/worker';
import { localStorage } from '@/server/media/storage';

import { createTestDb } from './helpers/db';
import { createUser } from './helpers/fixtures';

/** AI drafts are written in the background: the web request only queues them (Nginx closes silent requests after 60 s). */
let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

const content: GeneratedContent = {
  title: 'Trois vérifications avant d’acheter', hooks: [{ text: 'Avant d’acheter un portable, vérifiez ces trois points.', formula: 'Listicle' }],
  caption: 'Écran, batterie, clavier : trois vérifications simples.', cta: 'Enregistrez ce post.', hashtags: ['#ordinateurportable'], altText: '',
  script: [], slides: [], storyFrames: [], plan: [], notes: '', needsVerification: [],
};
const ok = () => ({ stop_reason: 'end_turn', parsed_output: content, usage: { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0 } });
const request = { kind: 'feed_image', topic: 'Trois points à vérifier avant d’acheter un portable' };

/** A Claude stand-in that answers after `ms`, or stops when the request is aborted (as the SDK does). */
function client(ms = 0, answer: () => unknown = ok): MessagesClient & { calls: number } {
  const fake = {
    calls: 0,
    beta: { messages: { parse: vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => {
      fake.calls += 1;
      return new Promise((resolve, reject) => {
        if (options?.signal?.aborted) return reject(new Anthropic.APIUserAbortError());
        const timer = setTimeout(() => resolve(answer()), ms);
        options?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Anthropic.APIUserAbortError()); }, { once: true });
      });
    }) } },
  };
  return fake as unknown as MessagesClient & { calls: number };
}

const deps = (claude: MessagesClient | null): GenerateDeps => ({
  db, client: claude, model: 'claude-opus-5-5', effort: 'medium', dailyLimit: 50, businessContext: 'Euro Digital, Maroc.',
  runTool: async () => null, catalog: { baseUrl: undefined },
});
const publishDeps = (): PublishDeps => ({
  db, meta: { appId: undefined, appSecret: undefined, configId: undefined, redirectUri: undefined, graphVersion: 'v26.0' },
  storage: localStorage('storage/test-media', undefined), encryptionKey: undefined, publishingMode: 'disabled',
});
const worker = (id: string, claude: MessagesClient) =>
  startWorker({ workerId: id, publishPollSeconds: 60, generationPollMs: 20, publishDeps: publishDeps(), generateDeps: deps(claude), log: () => {} });

const draftOf = async (id: string) => (await db.select().from(contentDrafts).where(eq(contentDrafts.id, id)))[0]!;
const generationOf = async (draftId: string) => (await db.select().from(aiGenerations).where(eq(aiGenerations.draftId, draftId)).orderBy(desc(aiGenerations.createdAt)))[0]!;
async function until(check: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('background generation', () => {
  it('returns at once with a "generating" draft; the worker writes version 1', async () => {
    const owner = await createUser(db);
    const claude = client();
    const { draft } = await queueGeneration(deps(claude), { ownerId: owner.id, userId: owner.id, request });
    expect(draft).toMatchObject({ status: 'generating', currentVersionId: null });
    expect(claude.calls).toBe(0); // nothing waits for Claude in the web request
    expect((await generationOf(draft.id)).status).toBe('queued');

    const running = worker('test-worker', claude);
    await until(async () => (await draftOf(draft.id)).status === 'draft');
    await running.stop(2000);
    const done = await draftOf(draft.id);
    expect(done.currentVersionId).not.toBeNull();
    expect(done.title).toBe('Trois vérifications avant d’acheter');
    expect(await generationOf(draft.id)).toMatchObject({ status: 'succeeded', lockedBy: null, attempts: 1, inputTokens: 1000 });
  });

  it('on stop, gives an unfinished generation back to the queue within the deadline; the next worker finishes it', async () => {
    const owner = await createUser(db);
    const { draft } = await queueGeneration(deps(client()), { ownerId: owner.id, userId: owner.id, request });
    const oldRelease = worker('old-release', client(60_000));
    await until(async () => (await generationOf(draft.id)).status === 'running');
    const started = Date.now();
    await oldRelease.stop(14_000);
    expect(Date.now() - started).toBeLessThan(2000); // the wait for Claude is aborted, not sat out
    expect(await generationOf(draft.id)).toMatchObject({ status: 'queued', lockedBy: null });
    expect((await draftOf(draft.id)).status).toBe('generating');

    const newRelease = worker('new-release', client(10));
    await until(async () => (await draftOf(draft.id)).status === 'draft');
    await newRelease.stop(2000);
    expect(await generationOf(draft.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('marks the draft "generation failed" with the reason, and "Try again" queues the same request', async () => {
    const owner = await createUser(db);
    const refused = client(0, () => ({ stop_reason: 'refusal', parsed_output: null, usage: {} }));
    const { draft, generationId } = await queueGeneration(deps(refused), { ownerId: owner.id, userId: owner.id, request });
    const claimed = await claimGeneration(db, 'w', new Date(), generationId);
    expect(await processGeneration(deps(refused), claimed!.id)).toMatchObject({ status: 'failed', error: { code: 'refused' } });
    expect(await draftOf(draft.id)).toMatchObject({ status: 'generation_failed', lastError: 'Claude declined this request. Rephrase the brief.' });

    await retryGeneration(deps(client()), { ownerId: owner.id, userId: owner.id, draftId: draft.id });
    expect((await draftOf(draft.id)).status).toBe('generating');
    const again = await generationOf(draft.id);
    expect(again.status).toBe('queued');
    expect(again.id).not.toBe(generationId);
  });

  it('gives a queued request to exactly one of two workers claiming at the same moment', async () => {
    const owner = await createUser(db);
    const { generationId } = await queueGeneration(deps(client()), { ownerId: owner.id, userId: owner.id, request });
    const now = new Date(Date.now() + 1000);
    const claims = await Promise.all([claimGeneration(db, 'release-a', now, generationId), claimGeneration(db, 'release-b', now, generationId)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('skips a request whose draft was archived meanwhile, without calling Claude', async () => {
    const owner = await createUser(db);
    const claude = client();
    const { draft, generationId } = await queueGeneration(deps(claude), { ownerId: owner.id, userId: owner.id, request });
    await archiveDraft(db, owner.id, draft.id);
    const claimed = await claimGeneration(db, 'w', new Date(), generationId);
    expect(await processGeneration(deps(claude), claimed!.id)).toMatchObject({ status: 'skipped' });
    expect(claude.calls).toBe(0);
    expect((await generationOf(draft.id)).status).toBe('failed');
  });
});
