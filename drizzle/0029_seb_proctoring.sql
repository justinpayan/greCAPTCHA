CREATE TABLE `conference_credentials` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `conference_submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `attempt_feedback` ADD `general_comment` text;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `require_seb` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `api_key_payer` text;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `launch_hash` text;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `launch_expires_at` integer;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `seb_session_hash` text;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `seb_session_expires_at` integer;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `setup_ends_at` integer;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `exam_started_at` integer;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `last_check_in_at` integer;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `recovered_outages` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conference_submissions` ADD `disqualification` text;--> statement-breakpoint
CREATE UNIQUE INDEX `conference_submissions_launch_unique` ON `conference_submissions` (`launch_hash`);