CREATE TABLE `activity` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`draft_id` varchar(36),
	`type` varchar(64) NOT NULL,
	`level` varchar(16) NOT NULL DEFAULT 'info',
	`message` text NOT NULL,
	`read_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `activity_id` PRIMARY KEY(`id`),
	CONSTRAINT `activity_level_check` CHECK(level in ('info', 'success', 'warning', 'error'))
);
--> statement-breakpoint
CREATE TABLE `ai_generations` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`draft_id` varchar(36),
	`request` longtext NOT NULL,
	`model` varchar(100) NOT NULL,
	`skills` longtext NOT NULL,
	`status` varchar(16) NOT NULL,
	`stop_reason` varchar(32),
	`input_tokens` int,
	`output_tokens` int,
	`cache_read_tokens` int,
	`duration_ms` int,
	`error` text,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_generations_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_generations_status_check` CHECK(status in ('succeeded', 'failed', 'refused', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` varchar(36) NOT NULL,
	`draft_id` varchar(36) NOT NULL,
	`version_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`decision` varchar(16) NOT NULL,
	`note` text,
	`content_hash` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `approvals_id` PRIMARY KEY(`id`),
	CONSTRAINT `approvals_decision_check` CHECK(decision in ('approved', 'rejected', 'invalidated'))
);
--> statement-breakpoint
CREATE TABLE `brand_profiles` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`voice_markdown` text NOT NULL,
	`default_language` varchar(8) NOT NULL DEFAULT 'fr',
	`timezone` varchar(64) NOT NULL DEFAULT 'Africa/Casablanca',
	`publishing_enabled` boolean NOT NULL DEFAULT false,
	`default_post_time` varchar(5) NOT NULL DEFAULT '19:00',
	`ai_retention_days` int NOT NULL DEFAULT 180,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `brand_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `brand_profiles_owner_unique` UNIQUE(`owner_id`),
	CONSTRAINT `brand_profiles_language_check` CHECK(default_language in ('fr', 'ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE `content_drafts` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`instagram_account_id` varchar(36),
	`kind` varchar(16) NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'draft',
	`current_version_id` varchar(36),
	`approved_version_id` varchar(36),
	`scheduled_at` datetime(3),
	`timezone` varchar(64) NOT NULL DEFAULT 'Africa/Casablanca',
	`published_media_id` varchar(64),
	`published_at` datetime(3),
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `content_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `content_drafts_status_check` CHECK(status in ('draft', 'awaiting_approval', 'approved', 'rejected', 'scheduled', 'publishing', 'published', 'failed', 'archived')),
	CONSTRAINT `content_drafts_kind_check` CHECK(kind in ('feed_image', 'reel', 'carousel', 'story', 'plan', 'idea'))
);
--> statement-breakpoint
CREATE TABLE `content_versions` (
	`id` varchar(36) NOT NULL,
	`draft_id` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`caption` text NOT NULL,
	`hashtags` longtext NOT NULL,
	`payload` longtext NOT NULL,
	`media_asset_id` varchar(36),
	`validation` longtext NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `content_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `content_versions_draft_version_unique` UNIQUE(`draft_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `instagram_accounts` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`ig_user_id` varchar(64) NOT NULL,
	`username` varchar(255) NOT NULL,
	`name` varchar(255),
	`profile_picture_url` text,
	`client_business_id` varchar(64),
	`login_config_id` varchar(64),
	`token_ciphertext` text,
	`token_type` varchar(32),
	`token_expires_at` datetime(3),
	`granted_scopes` longtext NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'connected',
	`last_checked_at` datetime(3),
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `instagram_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `instagram_accounts_owner_ig_unique` UNIQUE(`owner_id`,`ig_user_id`),
	CONSTRAINT `instagram_accounts_status_check` CHECK(status in ('connected', 'needs_reauth', 'error', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`storage` varchar(8) NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`mime_type` varchar(64) NOT NULL,
	`size_bytes` int NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`original_name` varchar(255),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `media_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `media_assets_storage_check` CHECK(storage in ('local', 's3')),
	CONSTRAINT `media_assets_mime_check` CHECK(mime_type in ('image/jpeg', 'video/mp4', 'image/png'))
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`state_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `oauth_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_states_hash_unique` UNIQUE(`state_hash`)
);
--> statement-breakpoint
CREATE TABLE `publish_logs` (
	`id` varchar(36) NOT NULL,
	`job_id` varchar(36) NOT NULL,
	`draft_id` varchar(36) NOT NULL,
	`step` varchar(64) NOT NULL,
	`outcome` varchar(32) NOT NULL,
	`message` text,
	`meta_error_code` int,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `publish_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `publishing_jobs` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`draft_id` varchar(36) NOT NULL,
	`version_id` varchar(36) NOT NULL,
	`instagram_account_id` varchar(36) NOT NULL,
	`run_at` datetime(3) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`locked_at` datetime(3),
	`locked_by` varchar(200),
	`idempotency_key` varchar(100) NOT NULL,
	`active_idempotency_key` varchar(100) GENERATED ALWAYS AS ((case when status in ('queued', 'running', 'succeeded') then idempotency_key end)) STORED,
	`active_draft_id` varchar(36) GENERATED ALWAYS AS ((case when status in ('queued', 'running') then draft_id end)) VIRTUAL,
	`container_id` varchar(64),
	`container_created_at` datetime(3),
	`ig_media_id` varchar(64),
	`last_error` text,
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `publishing_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `publishing_jobs_idempotency_unique` UNIQUE(`active_idempotency_key`),
	CONSTRAINT `publishing_jobs_one_active_per_draft` UNIQUE(`active_draft_id`),
	CONSTRAINT `publishing_jobs_status_check` CHECK(status in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(200) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` varchar(16) NOT NULL DEFAULT 'owner',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_role_check` CHECK(role in ('owner', 'editor'))
);
--> statement-breakpoint
ALTER TABLE `activity` ADD CONSTRAINT `activity_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity` ADD CONSTRAINT `activity_draft_id_content_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `content_drafts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_generations` ADD CONSTRAINT `ai_generations_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_generations` ADD CONSTRAINT `ai_generations_draft_id_content_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `content_drafts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_draft_id_content_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `content_drafts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_version_id_content_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `content_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD CONSTRAINT `brand_profiles_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD CONSTRAINT `content_drafts_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD CONSTRAINT `content_drafts_instagram_account_id_instagram_accounts_id_fk` FOREIGN KEY (`instagram_account_id`) REFERENCES `instagram_accounts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_versions` ADD CONSTRAINT `content_versions_draft_id_content_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `content_drafts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_versions` ADD CONSTRAINT `content_versions_media_asset_id_media_assets_id_fk` FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_versions` ADD CONSTRAINT `content_versions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `instagram_accounts` ADD CONSTRAINT `instagram_accounts_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_states` ADD CONSTRAINT `oauth_states_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publish_logs` ADD CONSTRAINT `publish_logs_job_id_publishing_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `publishing_jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publish_logs` ADD CONSTRAINT `publish_logs_draft_id_content_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `content_drafts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publishing_jobs` ADD CONSTRAINT `publishing_jobs_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publishing_jobs` ADD CONSTRAINT `publishing_jobs_draft_id_content_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `content_drafts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publishing_jobs` ADD CONSTRAINT `publishing_jobs_version_id_content_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `content_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publishing_jobs` ADD CONSTRAINT `publishing_jobs_instagram_account_id_instagram_accounts_id_fk` FOREIGN KEY (`instagram_account_id`) REFERENCES `instagram_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_owner_created_idx` ON `activity` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_generations_owner_created_idx` ON `ai_generations` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `approvals_draft_idx` ON `approvals` (`draft_id`);--> statement-breakpoint
CREATE INDEX `content_drafts_owner_status_idx` ON `content_drafts` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `content_drafts_scheduled_idx` ON `content_drafts` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `media_assets_owner_idx` ON `media_assets` (`owner_id`);--> statement-breakpoint
CREATE INDEX `publish_logs_draft_idx` ON `publish_logs` (`draft_id`);--> statement-breakpoint
CREATE INDEX `publish_logs_job_idx` ON `publish_logs` (`job_id`);--> statement-breakpoint
CREATE INDEX `publishing_jobs_due_idx` ON `publishing_jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);