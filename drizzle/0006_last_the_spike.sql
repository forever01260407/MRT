CREATE TABLE `device_axle_profile_events` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`previous_stage_count` integer,
	`stage_count` integer NOT NULL,
	`previous_axle_count` integer,
	`axle_count` integer NOT NULL,
	`previous_effective_date` text,
	`effective_date` text NOT NULL,
	`changed_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "device_axle_profile_events_stage_count_positive" CHECK("device_axle_profile_events"."stage_count" > 0),
	CONSTRAINT "device_axle_profile_events_axle_count_positive" CHECK("device_axle_profile_events"."axle_count" > 0),
	CONSTRAINT "device_axle_profile_events_previous_stage_count_positive" CHECK("device_axle_profile_events"."previous_stage_count" IS NULL OR "device_axle_profile_events"."previous_stage_count" > 0),
	CONSTRAINT "device_axle_profile_events_previous_axle_count_positive" CHECK("device_axle_profile_events"."previous_axle_count" IS NULL OR "device_axle_profile_events"."previous_axle_count" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_device_axle_profile_events_device_created_at` ON `device_axle_profile_events` (`device_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_device_axle_profile_events_created_at` ON `device_axle_profile_events` (`created_at`);