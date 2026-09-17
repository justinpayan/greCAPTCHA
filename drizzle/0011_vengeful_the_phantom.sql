CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`openrouter_key_ciphertext` text NOT NULL,
	`openrouter_key_iv` text NOT NULL,
	`openrouter_key_tag` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_normalized_unique` ON `users` (`username_normalized`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
DROP INDEX `study_templates_name_unique`;--> statement-breakpoint
ALTER TABLE `study_templates` ADD `owner_user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `study_templates_owner_name_unique` ON `study_templates` (`owner_user_id`,`name`);--> statement-breakpoint
CREATE INDEX `study_templates_owner_idx` ON `study_templates` (`owner_user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_state` (
	`owner_user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_user_id`, `key`),
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `app_state`;--> statement-breakpoint
ALTER TABLE `__new_app_state` RENAME TO `app_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `app_state_owner_idx` ON `app_state` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `question_sets` ADD `owner_user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `question_sets_owner_idx` ON `question_sets` (`owner_user_id`);