CREATE INDEX `attempts_taker_idx` ON `attempts` (`taker_user_id`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `openrouter_key_ciphertext`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `openrouter_key_iv`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `openrouter_key_tag`;