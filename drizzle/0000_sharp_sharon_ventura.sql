CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`submitted_count` integer NOT NULL,
	`inserted_count` integer NOT NULL,
	`duplicate_count` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`measured_at` text NOT NULL,
	`oil_level` real NOT NULL,
	`inspector` text NOT NULL,
	`record_type` text NOT NULL,
	`refill_amount` real,
	`import_batch_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "measurements_oil_level_nonnegative" CHECK("measurements"."oil_level" >= 0),
	CONSTRAINT "measurements_record_type_valid" CHECK("measurements"."record_type" IN ('量測', '補油'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `measurements_device_measured_at_uidx` ON `measurements` (`device_id`,`measured_at`);--> statement-breakpoint
CREATE INDEX `idx_measurements_measured_at` ON `measurements` (`measured_at`);--> statement-breakpoint
CREATE INDEX `idx_measurements_import_batch_id` ON `measurements` (`import_batch_id`);