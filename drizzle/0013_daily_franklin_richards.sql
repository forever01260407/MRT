CREATE TABLE IF NOT EXISTS `sign_in_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`username` text COLLATE NOCASE NOT NULL,
	`success` integer NOT NULL,
	`outcome` text NOT NULL,
	`source` text NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "sign_in_events_success_valid" CHECK("sign_in_events"."success" IN (0, 1)),
	CONSTRAINT "sign_in_events_outcome_valid" CHECK("sign_in_events"."outcome" IN ('success', 'invalid_credentials', 'account_not_found', 'account_disabled', 'account_locked', 'rate_limited')),
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`actor_user_id` text REFERENCES `users` (`id`),
	`actor_username` text NOT NULL,
	`actor_role` text NOT NULL,
	`source_ip` text NOT NULL,
	`user_agent` text,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`resource_label` text,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`result` text NOT NULL,
	`error_code` text,
	`metadata_json` text,
	`origin_type` text,
	`origin_id` text,
	CONSTRAINT "audit_events_result_valid" CHECK("audit_events"."result" IN ('success', 'failure'))
);--> statement-breakpoint
CREATE TABLE `__backup_sign_in_events` AS
SELECT `id`, `user_id`, `username`, `success`, `outcome`, `source`, `user_agent`, `created_at`
FROM `sign_in_events`;--> statement-breakpoint
CREATE TABLE `__backup_audit_events` AS
SELECT `id`, `occurred_at`, `actor_user_id`, `actor_username`, `actor_role`, `source_ip`, `user_agent`, `request_id`, `action`, `resource_type`, `resource_id`, `resource_label`, `before_json`, `after_json`, `reason`, `result`, `error_code`, `metadata_json`, `origin_type`, `origin_id`
FROM `audit_events`;--> statement-breakpoint
DROP TABLE `sign_in_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text COLLATE NOCASE NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`force_password_change` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_role_valid" CHECK("__new_users"."role" IN ('guest', 'user', 'userpro', 'supervisor', 'admin')),
	CONSTRAINT "users_status_valid" CHECK("__new_users"."status" IN ('active', 'pending', 'locked', 'disabled')),
	CONSTRAINT "users_force_password_change_valid" CHECK("__new_users"."force_password_change" IN (0, 1)),
	CONSTRAINT "users_password_iterations_positive" CHECK("__new_users"."password_iterations" > 0)
);--> statement-breakpoint
INSERT INTO `__new_users` (`id`, `name`, `username`, `role`, `status`, `password_hash`, `password_salt`, `password_iterations`, `session_version`, `force_password_change`, `last_login_at`, `created_by`, `created_at`, `updated_at`)
SELECT `id`, `name`, `username`, `role`, `status`, `password_hash`, `password_salt`, `password_iterations`, `session_version`, `force_password_change`, `last_login_at`, `created_by`, `created_at`, `updated_at`
FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uidx` ON `users` (`username` COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `sign_in_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`username` text COLLATE NOCASE NOT NULL,
	`success` integer NOT NULL,
	`outcome` text NOT NULL,
	`source` text NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "sign_in_events_success_valid" CHECK("sign_in_events"."success" IN (0, 1)),
	CONSTRAINT "sign_in_events_outcome_valid" CHECK("sign_in_events"."outcome" IN ('success', 'invalid_credentials', 'account_not_found', 'account_disabled', 'account_locked', 'rate_limited')),
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
);--> statement-breakpoint
INSERT INTO `sign_in_events` (`id`, `user_id`, `username`, `success`, `outcome`, `source`, `user_agent`, `created_at`)
SELECT `id`, `user_id`, `username`, `success`, `outcome`, `source`, `user_agent`, `created_at`
FROM `__backup_sign_in_events`;--> statement-breakpoint
CREATE INDEX `idx_sign_in_events_username_created_at` ON `sign_in_events` (`username`, `created_at`);--> statement-breakpoint
CREATE INDEX `idx_sign_in_events_created_at` ON `sign_in_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`actor_user_id` text REFERENCES `users` (`id`),
	`actor_username` text NOT NULL,
	`actor_role` text NOT NULL,
	`source_ip` text NOT NULL,
	`user_agent` text,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`resource_label` text,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`result` text NOT NULL,
	`error_code` text,
	`metadata_json` text,
	`origin_type` text,
	`origin_id` text,
	CONSTRAINT "audit_events_result_valid" CHECK("audit_events"."result" IN ('success', 'failure'))
);--> statement-breakpoint
INSERT INTO `audit_events` (`id`, `occurred_at`, `actor_user_id`, `actor_username`, `actor_role`, `source_ip`, `user_agent`, `request_id`, `action`, `resource_type`, `resource_id`, `resource_label`, `before_json`, `after_json`, `reason`, `result`, `error_code`, `metadata_json`, `origin_type`, `origin_id`)
SELECT `id`, `occurred_at`, `actor_user_id`, `actor_username`, `actor_role`, `source_ip`, `user_agent`, `request_id`, `action`, `resource_type`, `resource_id`, `resource_label`, `before_json`, `after_json`, `reason`, `result`, `error_code`, `metadata_json`, `origin_type`, `origin_id`
FROM `__backup_audit_events`;--> statement-breakpoint
CREATE INDEX `idx_audit_events_occurred_at` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_actor_occurred_at` ON `audit_events` (`actor_username`, `occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_action_occurred_at` ON `audit_events` (`action`, `occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_resource` ON `audit_events` (`resource_type`, `resource_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_origin_uidx` ON `audit_events` (`origin_type`, `origin_id`);--> statement-breakpoint
DROP TABLE `__backup_sign_in_events`;--> statement-breakpoint
DROP TABLE `__backup_audit_events`;
