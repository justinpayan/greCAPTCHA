ALTER TABLE `attempt_answers` DROP COLUMN `time_limit_seconds`;--> statement-breakpoint
ALTER TABLE `attempt_answers` DROP COLUMN `overrun_ms`;--> statement-breakpoint
ALTER TABLE `attempts` DROP COLUMN `countdown_hidden`;--> statement-breakpoint
ALTER TABLE `question_sets` DROP COLUMN `countdown_hidden`;