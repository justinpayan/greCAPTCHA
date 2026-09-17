CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`error` text,
	`attempt_id` text,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 1 NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`lease_until` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_created_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_owner_created_idx` ON `jobs` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_attempt_idx` ON `jobs` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_window_idx` ON `rate_limits` (`window_started_at`);