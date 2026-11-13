PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_openrouter_credentials` (
	`user_id` text NOT NULL,
	`endpoint` text DEFAULT 'openrouter' NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`label` text,
	`spending_limit` real,
	`limit_remaining` real,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `endpoint`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_openrouter_credentials`("user_id", "endpoint", "ciphertext", "iv", "auth_tag", "label", "spending_limit", "limit_remaining", "expires_at", "created_at", "updated_at") SELECT "user_id", 'openrouter', "ciphertext", "iv", "auth_tag", "label", "spending_limit", "limit_remaining", "expires_at", "created_at", "updated_at" FROM `openrouter_credentials`;--> statement-breakpoint
DROP TABLE `openrouter_credentials`;--> statement-breakpoint
ALTER TABLE `__new_openrouter_credentials` RENAME TO `openrouter_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `openrouter_credentials_expiry_idx` ON `openrouter_credentials` (`expires_at`);--> statement-breakpoint
ALTER TABLE `question_sets` ADD `endpoint` text DEFAULT 'openrouter' NOT NULL;