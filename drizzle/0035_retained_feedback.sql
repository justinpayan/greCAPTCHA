PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attempt_feedback` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`submitter_user_id` text,
	`submitted_at` text NOT NULL,
	`general_comment` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_attempt_feedback`("attempt_id", "submitter_user_id", "submitted_at", "general_comment") SELECT "attempt_id", "submitter_user_id", "submitted_at", "general_comment" FROM `attempt_feedback`;--> statement-breakpoint
DROP TABLE `attempt_feedback`;--> statement-breakpoint
ALTER TABLE `__new_attempt_feedback` RENAME TO `attempt_feedback`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attempt_feedback_submitter_idx` ON `attempt_feedback` (`submitter_user_id`);