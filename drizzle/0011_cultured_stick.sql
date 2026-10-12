CREATE TABLE `rail_wear_records` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`direction` text NOT NULL,
	`point_number` integer NOT NULL,
	`rail_side` text NOT NULL,
	`measured_at` text NOT NULL,
	`wear` real NOT NULL,
	`inspector` text NOT NULL,
	`method` text NOT NULL,
	`record_type` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_ip` text DEFAULT '未知' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "rail_wear_records_mode_valid" CHECK("rail_wear_records"."mode" IN ('tread', 'side')),
	CONSTRAINT "rail_wear_records_direction_valid" CHECK("rail_wear_records"."direction" IN ('up', 'down')),
	CONSTRAINT "rail_wear_records_point_positive" CHECK("rail_wear_records"."point_number" > 0),
	CONSTRAINT "rail_wear_records_side_valid" CHECK("rail_wear_records"."rail_side" IN ('left', 'right')),
	CONSTRAINT "rail_wear_records_wear_nonnegative" CHECK("rail_wear_records"."wear" >= 0),
	CONSTRAINT "rail_wear_records_type_valid" CHECK("rail_wear_records"."record_type" IN ('measurement', 'replacement'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rail_wear_records_location_date_uidx` ON `rail_wear_records` (`mode`,`direction`,`point_number`,`rail_side`,`measured_at`);--> statement-breakpoint
CREATE INDEX `idx_rail_wear_records_location_date` ON `rail_wear_records` (`mode`,`direction`,`point_number`,`rail_side`,`measured_at`);--> statement-breakpoint
CREATE INDEX `idx_rail_wear_records_created_at` ON `rail_wear_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `rail_wear_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`mode` text NOT NULL,
	`direction` text NOT NULL,
	`point_number` integer NOT NULL,
	`rail_side` text NOT NULL,
	`measured_at` text NOT NULL,
	`wear` real NOT NULL,
	`inspector` text NOT NULL,
	`method` text NOT NULL,
	`record_type` text NOT NULL,
	`note` text,
	`correction_reason` text NOT NULL,
	`corrected_by` text NOT NULL,
	`created_by` text NOT NULL,
	`source_ip` text DEFAULT '未知' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `rail_wear_records`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rail_wear_revisions_mode_valid" CHECK("rail_wear_revisions"."mode" IN ('tread', 'side')),
	CONSTRAINT "rail_wear_revisions_direction_valid" CHECK("rail_wear_revisions"."direction" IN ('up', 'down')),
	CONSTRAINT "rail_wear_revisions_point_positive" CHECK("rail_wear_revisions"."point_number" > 0),
	CONSTRAINT "rail_wear_revisions_side_valid" CHECK("rail_wear_revisions"."rail_side" IN ('left', 'right')),
	CONSTRAINT "rail_wear_revisions_wear_nonnegative" CHECK("rail_wear_revisions"."wear" >= 0),
	CONSTRAINT "rail_wear_revisions_type_valid" CHECK("rail_wear_revisions"."record_type" IN ('measurement', 'replacement'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rail_wear_revisions_record_revision_uidx` ON `rail_wear_revisions` (`record_id`,`revision_no`);--> statement-breakpoint
CREATE INDEX `idx_rail_wear_revisions_record_id` ON `rail_wear_revisions` (`record_id`);--> statement-breakpoint
CREATE INDEX `idx_rail_wear_revisions_created_at` ON `rail_wear_revisions` (`created_at`);