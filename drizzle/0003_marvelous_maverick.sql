CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`force_password_change` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_role_valid" CHECK("users"."role" IN ('user', 'supervisor', 'admin')),
	CONSTRAINT "users_status_valid" CHECK("users"."status" IN ('active', 'pending', 'locked', 'disabled')),
	CONSTRAINT "users_password_iterations_positive" CHECK("users"."password_iterations" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uidx` ON `users` (`username`);