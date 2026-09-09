PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
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
	CONSTRAINT "users_role_valid" CHECK("__new_users"."role" IN ('user', 'userpro', 'supervisor', 'admin')),
	CONSTRAINT "users_status_valid" CHECK("__new_users"."status" IN ('active', 'pending', 'locked', 'disabled')),
	CONSTRAINT "users_password_iterations_positive" CHECK("__new_users"."password_iterations" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "name", "username", "role", "status", "password_hash", "password_salt", "password_iterations", "force_password_change", "last_login_at", "created_by", "created_at", "updated_at") SELECT "id", "name", "username", "role", "status", "password_hash", "password_salt", "password_iterations", "force_password_change", "last_login_at", "created_by", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uidx` ON `users` (`username`);