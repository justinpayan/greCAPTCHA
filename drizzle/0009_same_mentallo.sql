ALTER TABLE `attempt_answers` ADD `timed_out` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `attempts` ADD `overall_time_limit_seconds` integer;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `overall_time_limit_seconds` integer;