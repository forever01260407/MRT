CREATE TABLE `device_axle_profiles` (
	`device_id` text PRIMARY KEY NOT NULL,
	`effective_date` text NOT NULL,
	`stage_count` integer NOT NULL,
	`axle_count` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "device_axle_profiles_stage_count_positive" CHECK("device_axle_profiles"."stage_count" > 0),
	CONSTRAINT "device_axle_profiles_axle_count_positive" CHECK("device_axle_profiles"."axle_count" > 0)
);
