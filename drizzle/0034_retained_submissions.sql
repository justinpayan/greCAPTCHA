PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conference_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`assessor_user_id` text NOT NULL,
	`taker_user_id` text,
	`generation_job_id` text,
	`question_set_id` text,
	`attempt_id` text,
	`paper_name` text NOT NULL,
	`contributions` text NOT NULL,
	`require_seb` integer DEFAULT false NOT NULL,
	`api_key_payer` text,
	`launch_hash` text,
	`launch_expires_at` integer,
	`seb_session_hash` text,
	`seb_session_expires_at` integer,
	`seb_finished_at` integer,
	`setup_ends_at` integer,
	`exam_started_at` integer,
	`last_check_in_at` integer,
	`recovered_outages` integer DEFAULT 0 NOT NULL,
	`disqualification` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `study_templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`taker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`generation_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_conference_submissions`("id", "template_id", "assessor_user_id", "taker_user_id", "generation_job_id", "question_set_id", "attempt_id", "paper_name", "contributions", "require_seb", "api_key_payer", "launch_hash", "launch_expires_at", "seb_session_hash", "seb_session_expires_at", "seb_finished_at", "setup_ends_at", "exam_started_at", "last_check_in_at", "recovered_outages", "disqualification", "created_at", "updated_at") SELECT "id", "template_id", "assessor_user_id", "taker_user_id", "generation_job_id", "question_set_id", "attempt_id", "paper_name", "contributions", "require_seb", "api_key_payer", "launch_hash", "launch_expires_at", "seb_session_hash", "seb_session_expires_at", "seb_finished_at", "setup_ends_at", "exam_started_at", "last_check_in_at", "recovered_outages", "disqualification", "created_at", "updated_at" FROM `conference_submissions`;--> statement-breakpoint
DROP TABLE `conference_submissions`;--> statement-breakpoint
ALTER TABLE `__new_conference_submissions` RENAME TO `conference_submissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `conference_submissions_template_idx` ON `conference_submissions` (`template_id`);--> statement-breakpoint
CREATE INDEX `conference_submissions_assessor_idx` ON `conference_submissions` (`assessor_user_id`);--> statement-breakpoint
CREATE INDEX `conference_submissions_taker_idx` ON `conference_submissions` (`taker_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conference_submissions_job_unique` ON `conference_submissions` (`generation_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conference_submissions_attempt_unique` ON `conference_submissions` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conference_submissions_launch_unique` ON `conference_submissions` (`launch_hash`);