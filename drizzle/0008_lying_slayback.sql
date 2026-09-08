CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`actor_user_id` text,
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
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_events_result_valid" CHECK("audit_events"."result" IN ('success', 'failure'))
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_occurred_at` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_actor_occurred_at` ON `audit_events` (`actor_username`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_action_occurred_at` ON `audit_events` (`action`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_resource` ON `audit_events` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_origin_uidx` ON `audit_events` (`origin_type`,`origin_id`);