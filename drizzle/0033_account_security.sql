CREATE TABLE `account_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`auth_version` integer NOT NULL,
	`payload` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_tokens_user_idx` ON `account_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `backup_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_deletions` (
	`path` text PRIMARY KEY NOT NULL,
	`not_before` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trusted_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`auth_version` integer NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_devices_token_hash_unique` ON `trusted_devices` (`token_hash`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `mfa_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `trusted_device_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `verified_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `auth_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mfa_secret` text;--> statement-breakpoint
ALTER TABLE `users` ADD `mfa_last_step` integer DEFAULT -1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_verified_email_unique` ON `users` (`verified_email`);--> statement-breakpoint
DELETE FROM sessions;
