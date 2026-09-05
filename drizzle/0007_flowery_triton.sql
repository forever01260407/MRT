CREATE TABLE `measurement_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`measurement_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`source_ip` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`measurement_id`) REFERENCES `measurements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "measurement_lifecycle_events_action_valid" CHECK("measurement_lifecycle_events"."action" IN ('deleted', 'restored'))
);
--> statement-breakpoint
CREATE INDEX `idx_measurement_lifecycle_events_measurement_created_at` ON `measurement_lifecycle_events` (`measurement_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_measurement_lifecycle_events_created_at` ON `measurement_lifecycle_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `device_axle_profile_events` ADD `source_ip` text DEFAULT '未知' NOT NULL;--> statement-breakpoint
ALTER TABLE `measurement_revisions` ADD `source_ip` text DEFAULT '未知' NOT NULL;--> statement-breakpoint
ALTER TABLE `measurements` ADD `created_ip` text DEFAULT '未知' NOT NULL;--> statement-breakpoint
ALTER TABLE `measurements` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `deleted_ip` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `delete_reason` text;--> statement-breakpoint
CREATE INDEX `idx_measurements_deleted_at` ON `measurements` (`deleted_at`);