UPDATE `conference_submissions`
SET `attempt_id` = NULL
WHERE `attempt_id` IN (
	SELECT `id` FROM `attempts` WHERE `experiment_id` IS NOT NULL
);--> statement-breakpoint
DELETE FROM `attempt_feedback`
WHERE `attempt_id` IN (
	SELECT `id` FROM `attempts` WHERE `experiment_id` IS NOT NULL
);--> statement-breakpoint
DELETE FROM `attempt_answers`
WHERE `attempt_id` IN (
	SELECT `id` FROM `attempts` WHERE `experiment_id` IS NOT NULL
);--> statement-breakpoint
DELETE FROM `attempts` WHERE `experiment_id` IS NOT NULL;--> statement-breakpoint
DROP INDEX `attempts_experiment_idx`;--> statement-breakpoint
ALTER TABLE `attempts` DROP COLUMN `experiment_id`;--> statement-breakpoint
ALTER TABLE `attempts` DROP COLUMN `condition`;--> statement-breakpoint
DROP TABLE `experiments`;