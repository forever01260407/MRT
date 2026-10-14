CREATE TABLE `rail_wear_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`source_ip` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `rail_wear_records`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rail_wear_lifecycle_action_valid" CHECK("rail_wear_lifecycle_events"."action" IN ('deleted', 'restored'))
);
--> statement-breakpoint
CREATE INDEX `idx_rail_wear_lifecycle_record_created_at` ON `rail_wear_lifecycle_events` (`record_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_rail_wear_lifecycle_created_at` ON `rail_wear_lifecycle_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `rail_wear_records` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `rail_wear_records` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `rail_wear_records` ADD `deleted_ip` text;--> statement-breakpoint
ALTER TABLE `rail_wear_records` ADD `delete_reason` text;--> statement-breakpoint
CREATE INDEX `idx_rail_wear_records_deleted_at` ON `rail_wear_records` (`deleted_at`);