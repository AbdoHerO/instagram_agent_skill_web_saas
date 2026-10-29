import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  datetime,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Persistent data (MySQL 8; the tests also run on MariaDB 10.4+). Every row that
 * belongs to someone carries `owner_id`, and every query in src/server filters
 * on it. Secrets are never stored in plaintext: passwords are argon2 hashes,
 * session and OAuth state tokens are SHA-256 hashes, Meta access tokens are
 * AES-256-GCM ciphertext.
 *
 * Portable choices: ids are UUIDs chosen by the application, times are UTC
 * `datetime(3)` written by the application, and JSON and lists are stored as
 * JSON text (MariaDB's JSON type is text, MySQL's is not; text behaves the same
 * on both).
 */

/** JSON stored as text, parsed on read. */
const jsonText = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => 'longtext',
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => JSON.parse(value) as T,
  })(name);

const id = () => varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID());
const ref = (name: string) => varchar(name, { length: 36 });
const time = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const created = () => time('created_at').notNull().$defaultFn(() => new Date());
const updated = () => time('updated_at').notNull().$defaultFn(() => new Date());
const longText = (name: string) => text(name).notNull().$defaultFn(() => '');

export const DRAFT_STATUSES = ['draft', 'awaiting_approval', 'approved', 'rejected', 'scheduled', 'publishing', 'published', 'failed', 'archived'] as const;
export const DRAFT_KINDS = ['feed_image', 'reel', 'carousel', 'story', 'plan', 'idea'] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const ACCOUNT_STATUSES = ['connected', 'needs_reauth', 'error', 'disconnected'] as const;

const inList = (column: string, values: readonly string[]) => sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const users = mysqlTable('users', {
  id: id(),
  /** Stored lower-case; the unique index is case-insensitive as well (utf8mb4 *_ci collations). */
  email: varchar('email', { length: 320 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 16 }).notNull().default('owner'),
  createdAt: created(),
}, (t) => [uniqueIndex('users_email_unique').on(t.email), check('users_role_check', inList('role', ['owner', 'editor']))]);

export const sessions = mysqlTable('sessions', {
  id: id(),
  userId: ref('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: time('expires_at').notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex('sessions_token_hash_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);

export const brandProfiles = mysqlTable('brand_profiles', {
  id: id(),
  ownerId: ref('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  voiceMarkdown: longText('voice_markdown'),
  defaultLanguage: varchar('default_language', { length: 8 }).notNull().default('fr'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Africa/Casablanca'),
  /** Second switch next to PUBLISHING_MODE: both must allow publishing. Off by default. */
  publishingEnabled: boolean('publishing_enabled').notNull().default(false),
  defaultPostTime: varchar('default_post_time', { length: 5 }).notNull().default('19:00'),
  aiRetentionDays: int('ai_retention_days').notNull().default(180),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('brand_profiles_owner_unique').on(t.ownerId),
  check('brand_profiles_language_check', inList('default_language', ['fr', 'ar', 'en'])),
]);

export const instagramAccounts = mysqlTable('instagram_accounts', {
  id: id(),
  ownerId: ref('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  igUserId: varchar('ig_user_id', { length: 64 }).notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  profilePictureUrl: text('profile_picture_url'),
  clientBusinessId: varchar('client_business_id', { length: 64 }),
  loginConfigId: varchar('login_config_id', { length: 64 }),
  /** AES-256-GCM ciphertext of the Business Integration System User access token (variable length). */
  tokenCiphertext: text('token_ciphertext'),
  tokenType: varchar('token_type', { length: 32 }),
  tokenExpiresAt: time('token_expires_at'),
  grantedScopes: jsonText<string[]>('granted_scopes').notNull().$defaultFn(() => []),
  status: varchar('status', { length: 16 }).notNull().default('connected'),
  lastCheckedAt: time('last_checked_at'),
  lastError: text('last_error'),
  connectedAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('instagram_accounts_owner_ig_unique').on(t.ownerId, t.igUserId),
  check('instagram_accounts_status_check', inList('status', ACCOUNT_STATUSES)),
]);

export const oauthStates = mysqlTable('oauth_states', {
  id: id(),
  userId: ref('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stateHash: varchar('state_hash', { length: 64 }).notNull(),
  expiresAt: time('expires_at').notNull(),
  usedAt: time('used_at'),
  createdAt: created(),
}, (t) => [uniqueIndex('oauth_states_hash_unique').on(t.stateHash)]);

export const mediaAssets = mysqlTable('media_assets', {
  id: id(),
  ownerId: ref('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  storage: varchar('storage', { length: 8 }).notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 64 }).notNull(),
  sizeBytes: int('size_bytes').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  originalName: varchar('original_name', { length: 255 }),
  createdAt: created(),
}, (t) => [
  index('media_assets_owner_idx').on(t.ownerId),
  check('media_assets_storage_check', inList('storage', ['local', 's3'])),
  check('media_assets_mime_check', inList('mime_type', ['image/jpeg', 'video/mp4', 'image/png'])),
]);

export const contentDrafts = mysqlTable('content_drafts', {
  id: id(),
  ownerId: ref('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  instagramAccountId: ref('instagram_account_id').references(() => instagramAccounts.id, { onDelete: 'set null' }),
  kind: varchar('kind', { length: 16 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('draft'),
  currentVersionId: ref('current_version_id'),
  approvedVersionId: ref('approved_version_id'),
  scheduledAt: time('scheduled_at'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Africa/Casablanca'),
  publishedMediaId: varchar('published_media_id', { length: 64 }),
  publishedAt: time('published_at'),
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
export const contentVersions = mysqlTable('content_versions', {
  id: id(),
  draftId: ref('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  version: int('version').notNull(),
  caption: longText('caption'),
  hashtags: jsonText<string[]>('hashtags').notNull().$defaultFn(() => []),
  payload: jsonText<unknown>('payload').notNull().$defaultFn(() => ({})),
  mediaAssetId: ref('media_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  validation: jsonText<unknown>('validation').notNull().$defaultFn(() => ({})),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  createdBy: ref('created_by').notNull().references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex('content_versions_draft_version_unique').on(t.draftId, t.version)]);

export const approvals = mysqlTable('approvals', {
  id: id(),
  draftId: ref('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  versionId: ref('version_id').notNull().references(() => contentVersions.id, { onDelete: 'cascade' }),
  userId: ref('user_id').notNull().references(() => users.id),
  decision: varchar('decision', { length: 16 }).notNull(),
  note: text('note'),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  createdAt: created(),
}, (t) => [
  index('approvals_draft_idx').on(t.draftId),
  check('approvals_decision_check', inList('decision', ['approved', 'rejected', 'invalidated'])),
]);

export const publishingJobs = mysqlTable('publishing_jobs', {
  id: id(),
  ownerId: ref('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  draftId: ref('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  versionId: ref('version_id').notNull().references(() => contentVersions.id),
  instagramAccountId: ref('instagram_account_id').notNull().references(() => instagramAccounts.id),
  runAt: time('run_at').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('queued'),
  attempts: int('attempts').notNull().default(0),
  maxAttempts: int('max_attempts').notNull().default(5),
  lockedAt: time('locked_at'),
  lockedBy: varchar('locked_by', { length: 200 }),
  /** One live publish per approved version (`publish:<version id>`): a retry can never publish it twice. Failed and cancelled jobs stay as history. */
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  /**
   * MySQL has no partial unique index: these generated columns hold the key (or
   * the draft) only while the job is live and NULL otherwise, and a unique index
   * on them allows any number of NULLs. `active_draft_id` is virtual because
   * MySQL refuses a stored generated column over a cascading foreign key.
   */
  activeIdempotencyKey: varchar('active_idempotency_key', { length: 100 })
    .generatedAlwaysAs(sql`(case when status in ('queued', 'running', 'succeeded') then idempotency_key end)`, { mode: 'stored' }),
  activeDraftId: varchar('active_draft_id', { length: 36 })
    .generatedAlwaysAs(sql`(case when status in ('queued', 'running') then draft_id end)`, { mode: 'virtual' }),
  containerId: varchar('container_id', { length: 64 }),
  containerCreatedAt: time('container_created_at'),
  igMediaId: varchar('ig_media_id', { length: 64 }),
  lastError: text('last_error'),
  finishedAt: time('finished_at'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('publishing_jobs_idempotency_unique').on(t.activeIdempotencyKey),
  // At most one queued or running job per draft.
  uniqueIndex('publishing_jobs_one_active_per_draft').on(t.activeDraftId),
  index('publishing_jobs_due_idx').on(t.status, t.runAt),
  check('publishing_jobs_status_check', inList('status', JOB_STATUSES)),
]);

export const publishLogs = mysqlTable('publish_logs', {
  id: id(),
  jobId: ref('job_id').notNull().references(() => publishingJobs.id, { onDelete: 'cascade' }),
  draftId: ref('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  step: varchar('step', { length: 64 }).notNull(),
  outcome: varchar('outcome', { length: 32 }).notNull(),
  message: text('message'),
  metaErrorCode: int('meta_error_code'),
  createdAt: created(),
}, (t) => [index('publish_logs_draft_idx').on(t.draftId), index('publish_logs_job_idx').on(t.jobId)]);

export const aiGenerations = mysqlTable('ai_generations', {
  id: id(),
  ownerId: ref('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  draftId: ref('draft_id').references(() => contentDrafts.id, { onDelete: 'set null' }),
  request: jsonText<unknown>('request').notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  skills: jsonText<string[]>('skills').notNull().$defaultFn(() => []),
  status: varchar('status', { length: 16 }).notNull(),
  stopReason: varchar('stop_reason', { length: 32 }),
  inputTokens: int('input_tokens'),
  outputTokens: int('output_tokens'),
  cacheReadTokens: int('cache_read_tokens'),
  durationMs: int('duration_ms'),
  error: text('error'),
  createdAt: created(),
}, (t) => [
  index('ai_generations_owner_created_idx').on(t.ownerId, t.createdAt),
  check('ai_generations_status_check', inList('status', ['succeeded', 'failed', 'refused', 'invalid'])),
]);

export const activity = mysqlTable('activity', {
  id: id(),
  ownerId: ref('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  draftId: ref('draft_id').references(() => contentDrafts.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 64 }).notNull(),
  level: varchar('level', { length: 16 }).notNull().default('info'),
  message: text('message').notNull(),
  readAt: time('read_at'),
  createdAt: created(),
}, (t) => [
  index('activity_owner_created_idx').on(t.ownerId, t.createdAt),
  check('activity_level_check', inList('level', ['info', 'success', 'warning', 'error'])),
]);
