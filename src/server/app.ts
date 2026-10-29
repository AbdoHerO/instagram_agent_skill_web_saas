import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import type { GenerateDeps } from '@/server/ai/generate';
import { getDb } from '@/server/db';
import { env } from '@/server/env';
import type { PublishDeps } from '@/server/jobs/publish';
import { localStorage, s3Storage, type MediaStorage } from '@/server/media/storage';
import type { MetaConfig } from '@/server/meta/graph';
import { pythonToolRunner } from '@/server/skills/tools';

/** Builds the services' dependencies from the server configuration. */
export function metaConfig(): MetaConfig {
  const e = env();
  return { appId: e.META_APP_ID, appSecret: e.META_APP_SECRET, configId: e.META_LOGIN_CONFIG_ID, redirectUri: e.META_REDIRECT_URI, graphVersion: e.META_GRAPH_VERSION };
}

export function mediaStorage(): MediaStorage {
  const e = env();
  if (e.MEDIA_STORAGE === 's3') {
    if (!e.S3_BUCKET || !e.S3_REGION) throw new Error('S3_BUCKET and S3_REGION are required when MEDIA_STORAGE=s3');
    return s3Storage({ bucket: e.S3_BUCKET, region: e.S3_REGION, endpoint: e.S3_ENDPOINT, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY });
  }
  return localStorage(e.MEDIA_LOCAL_DIR, e.MEDIA_PUBLIC_BASE_URL);
}

let businessContext: string | null = null;
function loadBusinessContext(): string {
  businessContext ??= readFileSync(join(process.cwd(), 'docs', 'business-context.md'), 'utf8');
  return businessContext;
}

export function generateDeps(): GenerateDeps {
  const e = env();
  return {
    db: getDb(),
    client: e.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 5 * 60_000 }) : null,
    model: e.CLAUDE_MODEL,
    effort: e.CLAUDE_EFFORT,
    dailyLimit: e.AI_DAILY_GENERATION_LIMIT,
    catalog: { baseUrl: e.ECOMMERCE_API_URL, storefrontUrl: e.STOREFRONT_PUBLIC_URL },
    businessContext: loadBusinessContext(),
    runTool: pythonToolRunner(e.PYTHON_BIN),
  };
}

export function publishDeps(): PublishDeps {
  const e = env();
  return { db: getDb(), meta: metaConfig(), storage: mediaStorage(), encryptionKey: e.TOKEN_ENCRYPTION_KEY, publishingMode: e.PUBLISHING_MODE };
}
