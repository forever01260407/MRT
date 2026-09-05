CREATE TABLE `sign_in_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`username` text NOT NULL,
	`success` integer NOT NULL,
	`outcome` text NOT NULL,
	`source` text NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sign_in_events_success_valid" CHECK("sign_in_events"."success" IN (0, 1)),
	CONSTRAINT "sign_in_events_outcome_valid" CHECK("sign_in_events"."outcome" IN ('success', 'invalid_credentials', 'account_not_found', 'account_disabled', 'account_locked', 'rate_limited'))
);
--> statement-breakpoint
CREATE INDEX `idx_sign_in_events_username_created_at` ON `sign_in_events` (`username`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sign_in_events_created_at` ON `sign_in_events` (`created_at`);