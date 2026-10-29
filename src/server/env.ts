import 'server-only';

import { z } from 'zod';

/**
 * Server configuration, read once and validated. Secrets live only in the
 * process environment (.env.local in development, the host's secret settings in
 * production) and are never sent to the browser or written to logs.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3100'),
  DATABASE_URL: z.string().min(1).optional(),
  /** 32 random bytes, base64: encrypts Meta tokens at rest (AES-256-GCM). */
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),

  ANTHROPIC_API_KEY: z.string().optional(),
  /** Only for a key that is not scoped to a workspace: sent as the anthropic-workspace-id header. Not a secret. */
  ANTHROPIC_WORKSPACE_ID: z.string().regex(/^wrkspc_[A-Za-z0-9]+$/).optional(),
  CLAUDE_MODEL: z.string().default('claude-opus-5-5'),
  CLAUDE_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  AI_DAILY_GENERATION_LIMIT: z.coerce.number().int().min(1).max(10_000).default(50),
  PYTHON_BIN: z.string().default('python3'),

  /** Read-only product data: the e-commerce backend's public API (e.g. http://192.168.1.7:8010/api/v1). */
  ECOMMERCE_API_URL: z.url().optional(),
  /** Public website address, for product links in posts (none chosen yet: leave empty). */
  STOREFRONT_PUBLIC_URL: z.url().optional(),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** Facebook Login for Business configuration (Unified Login, system-user access token). Not a secret. */
  META_LOGIN_CONFIG_ID: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v26.0'),
  /** Exact redirect URI registered in the app's Facebook Login for Business settings. */
  META_REDIRECT_URI: z.url().optional(),
  /** disabled (default): the worker never calls the publishing API. live: publishing allowed. */
  PUBLISHING_MODE: z.enum(['disabled', 'live']).default('disabled'),

  MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
  MEDIA_LOCAL_DIR: z.string().default('storage/media'),
  /** Public base URL Meta can reach to download media (https in production). */
  MEDIA_PUBLIC_BASE_URL: z.url().optional(),
  MEDIA_MAX_BYTES: z.coerce.number().int().default(100 * 1024 * 1024),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  WORKER_POLL_SECONDS: z.coerce.number().int().min(1).max(300).default(15),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    // An empty line such as `ECOMMERCE_API_URL=` means "not set", not an invalid value.
    const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));
    if (!parsed.success) {
      // Names only: never print values.
      throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests: forget the cached configuration after changing process.env. */
export function resetEnvCache(): void {
  cached = null;
}

/** What is configured, as booleans only (safe to show in the dashboard). */
export function configStatus() {
  const e = env();
  return {
    database: Boolean(e.DATABASE_URL),
    encryptionKey: Boolean(e.TOKEN_ENCRYPTION_KEY),
    anthropic: Boolean(e.ANTHROPIC_API_KEY),
    ecommerceApi: Boolean(e.ECOMMERCE_API_URL),
    metaApp: Boolean(e.META_APP_ID && e.META_APP_SECRET),
    metaLoginConfig: Boolean(e.META_LOGIN_CONFIG_ID),
    metaRedirect: Boolean(e.META_REDIRECT_URI),
    mediaPublicUrl: Boolean(e.MEDIA_PUBLIC_BASE_URL) || e.MEDIA_STORAGE === 's3',
    publishingMode: e.PUBLISHING_MODE,
    model: e.CLAUDE_MODEL,
  };
}
