import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Persistent data. Every row that belongs to someone carries `owner_id`, and
 * every query in src/server filters on it. Secrets are never stored in
 * plaintext: passwords are argon2 hashes, session and OAuth state tokens are
 * SHA-256 hashes, Meta access tokens are AES-256-GCM ciphertext.
 */

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const DRAFT_STATUSES = ['draft', 'awaiting_approval', 'approved', 'rejected', 'scheduled', 'publishing', 'published', 'failed', 'archived'] as const;
export const DRAFT_KINDS = ['feed_image', 'reel', 'carousel', 'story', 'plan', 'idea'] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const ACCOUNT_STATUSES = ['connected', 'needs_reauth', 'error', 'disconnected'] as const;

const inList = (column: string, values: readonly string[]) => sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('owner'),
  createdAt: created(),
}, (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`), check('users_role_check', inList('role', ['owner', 'editor']))]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex('sessions_token_hash_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);

export const brandProfiles = pgTable('brand_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  voiceMarkdown: text('voice_markdown').notNull().default(''),
  defaultLanguage: text('default_language').notNull().default('fr'),
  timezone: text('timezone').notNull().default('Africa/Casablanca'),
  /** Second switch next to PUBLISHING_MODE: both must allow publishing. Off by default. */
  publishingEnabled: boolean('publishing_enabled').notNull().default(false),
  defaultPostTime: text('default_post_time').notNull().default('19:00'),
  aiRetentionDays: integer('ai_retention_days').notNull().default(180),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('brand_profiles_owner_unique').on(t.ownerId),
  check('brand_profiles_language_check', inList('default_language', ['fr', 'ar', 'en'])),
]);

export const instagramAccounts = pgTable('instagram_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  igUserId: text('ig_user_id').notNull(),
  username: text('username').notNull(),
  name: text('name'),
  profilePictureUrl: text('profile_picture_url'),
  clientBusinessId: text('client_business_id'),
  loginConfigId: text('login_config_id'),
  /** AES-256-GCM ciphertext of the Business Integration System User access token (variable length). */
  tokenCiphertext: text('token_ciphertext'),
  tokenType: text('token_type'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  grantedScopes: text('granted_scopes').array().notNull().default(sql`'{}'::text[]`),
  status: text('status').notNull().default('connected'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastError: text('last_error'),
  connectedAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('instagram_accounts_owner_ig_unique').on(t.ownerId, t.igUserId),
  check('instagram_accounts_status_check', inList('status', ACCOUNT_STATUSES)),
]);

export const oauthStates = pgTable('oauth_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stateHash: text('state_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: created(),
}, (t) => [uniqueIndex('oauth_states_hash_unique').on(t.stateHash)]);

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  storage: text('storage').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  originalName: text('original_name'),
  createdAt: created(),
}, (t) => [
  index('media_assets_owner_idx').on(t.ownerId),
  check('media_assets_storage_check', inList('storage', ['local', 's3'])),
  check('media_assets_mime_check', inList('mime_type', ['image/jpeg', 'video/mp4', 'image/png'])),
]);

export const contentDrafts = pgTable('content_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  instagramAccountId: uuid('instagram_account_id').references(() => instagramAccounts.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  currentVersionId: uuid('current_version_id'),
  approvedVersionId: uuid('approved_version_id'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  timezone: text('timezone').notNull().default('Africa/Casablanca'),
  publishedMediaId: text('published_media_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('content_drafts_owner_status_idx').on(t.ownerId, t.status),
  index('content_drafts_scheduled_idx').on(t.scheduledAt),
  check('content_drafts_status_check', inList('status', DRAFT_STATUSES)),
  check('content_drafts_kind_check', inList('kind', DRAFT_KINDS)),
]);

/** Immutable: a version is never updated; an edit creates the next version. */
export const contentVersions = pgTable('content_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  draftId: uuid('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  caption: text('caption').notNull().default(''),
  hashtags: text('hashtags').array().notNull().default(sql`'{}'::text[]`),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  validation: jsonb('validation').notNull().default(sql`'{}'::jsonb`),
  contentHash: text('content_hash').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex('content_versions_draft_version_unique').on(t.draftId, t.version)]);

export const approvals = pgTable('approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  draftId: uuid('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => contentVersions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  decision: text('decision').notNull(),
  note: text('note'),
  contentHash: text('content_hash').notNull(),
  createdAt: created(),
}, (t) => [
  index('approvals_draft_idx').on(t.draftId),
  check('approvals_decision_check', inList('decision', ['approved', 'rejected', 'invalidated'])),
]);

export const publishingJobs = pgTable('publishing_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  draftId: uuid('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => contentVersions.id),
  instagramAccountId: uuid('instagram_account_id').notNull().references(() => instagramAccounts.id),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  /** One live publish per approved version (`publish:<version id>`): a retry can never publish it twice. Failed and cancelled jobs stay as history. */
  idempotencyKey: text('idempotency_key').notNull(),
  containerId: text('container_id'),
  containerCreatedAt: timestamp('container_created_at', { withTimezone: true }),
  igMediaId: text('ig_media_id'),
  lastError: text('last_error'),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('publishing_jobs_idempotency_unique').on(t.idempotencyKey).where(sql`status in ('queued', 'running', 'succeeded')`),
  // At most one queued or running job per draft.
  uniqueIndex('publishing_jobs_one_active_per_draft').on(t.draftId).where(sql`status in ('queued', 'running')`),
  index('publishing_jobs_due_idx').on(t.status, t.runAt),
  check('publishing_jobs_status_check', inList('status', JOB_STATUSES)),
]);

export const publishLogs = pgTable('publish_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => publishingJobs.id, { onDelete: 'cascade' }),
  draftId: uuid('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  step: text('step').notNull(),
  outcome: text('outcome').notNull(),
  message: text('message'),
  metaErrorCode: integer('meta_error_code'),
  createdAt: created(),
}, (t) => [index('publish_logs_draft_idx').on(t.draftId), index('publish_logs_job_idx').on(t.jobId)]);

export const aiGenerations = pgTable('ai_generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  draftId: uuid('draft_id').references(() => contentDrafts.id, { onDelete: 'set null' }),
  request: jsonb('request').notNull(),
  model: text('model').notNull(),
  skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
  status: text('status').notNull(),
  stopReason: text('stop_reason'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: created(),
}, (t) => [
  index('ai_generations_owner_created_idx').on(t.ownerId, t.createdAt),
  check('ai_generations_status_check', inList('status', ['succeeded', 'failed', 'refused', 'invalid'])),
]);

export const activity = pgTable('activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  draftId: uuid('draft_id').references(() => contentDrafts.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  level: text('level').notNull().default('info'),
  message: text('message').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: created(),
}, (t) => [
  index('activity_owner_created_idx').on(t.ownerId, t.createdAt),
  check('activity_level_check', inList('level', ['info', 'success', 'warning', 'error'])),
]);
