PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`openrouter_key_ciphertext` text,
	`openrouter_key_iv` text,
	`openrouter_key_tag` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "username_normalized", "password_hash", "password_salt", "openrouter_key_ciphertext", "openrouter_key_iv", "openrouter_key_tag", "created_at", "updated_at") SELECT "id", "username", "username_normalized", "password_hash", "password_salt", "openrouter_key_ciphertext", "openrouter_key_iv", "openrouter_key_tag", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_normalized_unique` ON `users` (`username_normalized`);--> statement-breakpoint
ALTER TABLE `attempts` ADD `taker_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `attempts` ADD `taker_username` text;