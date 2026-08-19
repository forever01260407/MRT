CREATE TABLE `measurement_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`measurement_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`device_id` text NOT NULL,
	`measured_at` text NOT NULL,
	`oil_level` real NOT NULL,
	`inspector` text NOT NULL,
	`record_type` text NOT NULL,
	`refill_amount` real,
	`correction_reason` text NOT NULL,
	`corrected_by` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`measurement_id`) REFERENCES `measurements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "measurement_revisions_oil_level_nonnegative" CHECK("measurement_revisions"."oil_level" >= 0),
	CONSTRAINT "measurement_revisions_record_type_valid" CHECK("measurement_revisions"."record_type" IN ('量測', '補油'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `measurement_revisions_measurement_revision_uidx` ON `measurement_revisions` (`measurement_id`,`revision_no`);--> statement-breakpoint
CREATE INDEX `idx_measurement_revisions_measurement_id` ON `measurement_revisions` (`measurement_id`);--> statement-breakpoint
CREATE INDEX `idx_measurement_revisions_created_at` ON `measurement_revisions` (`created_at`);