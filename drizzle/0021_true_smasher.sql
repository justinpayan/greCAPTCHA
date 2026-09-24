DELETE FROM `attempt_feedback`;--> statement-breakpoint
CREATE TABLE `attempt_question_feedback` (
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`comment` text NOT NULL,
	PRIMARY KEY(`attempt_id`, `question_id`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `attempt_feedback` DROP COLUMN `comment`;