CREATE TABLE `attempt_feedback` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`submitter_user_id` text NOT NULL,
	`comment` text NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempt_feedback_submitter_idx` ON `attempt_feedback` (`submitter_user_id`);--> statement-breakpoint
CREATE TABLE `conference_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`assessor_user_id` text NOT NULL,
	`taker_user_id` text NOT NULL,
	`generation_job_id` text,
	`question_set_id` text,
	`attempt_id` text,
	`paper_name` text NOT NULL,
	`contributions` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `study_templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`taker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conference_submissions_template_idx` ON `conference_submissions` (`template_id`);--> statement-breakpoint
CREATE INDEX `conference_submissions_assessor_idx` ON `conference_submissions` (`assessor_user_id`);--> statement-breakpoint
CREATE INDEX `conference_submissions_taker_idx` ON `conference_submissions` (`taker_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conference_submissions_job_unique` ON `conference_submissions` (`generation_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conference_submissions_attempt_unique` ON `conference_submissions` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `openrouter_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`label` text,
	`spending_limit` real NOT NULL,
	`limit_remaining` real,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `openrouter_credentials_expiry_idx` ON `openrouter_credentials` (`expires_at`);--> statement-breakpoint
ALTER TABLE `attempts` ADD `active_question_started_at` text;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `source_template_id` text REFERENCES study_templates(id);--> statement-breakpoint
ALTER TABLE `question_sets` ADD `workflow_type` text DEFAULT 'course' NOT NULL;--> statement-breakpoint
CREATE INDEX `question_sets_source_template_idx` ON `question_sets` (`source_template_id`);--> statement-breakpoint
ALTER TABLE `study_templates` ADD `workflow_type` text DEFAULT 'course' NOT NULL;--> statement-breakpoint
ALTER TABLE `study_templates` ADD `conference_share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `study_templates_conference_share_token_unique` ON `study_templates` (`conference_share_token`);