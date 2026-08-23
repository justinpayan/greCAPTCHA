-- No pragma here. Rebuilding a table that others reference needs foreign keys off, and that
-- cannot be set from inside the migrator's transaction; `src/db/index.ts` does it around the
-- whole migration run and verifies integrity afterwards.
CREATE TABLE `__new_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`own_question_set_id` text,
	`foreign_question_set_id` text,
	`foreign_first` integer NOT NULL,
	`randomize` integer DEFAULT false NOT NULL,
	`countdown_hidden` integer DEFAULT false NOT NULL,
	`foreign_stratum` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`own_question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`foreign_question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
-- The two settings columns are new, so they are not copied: existing rows take their defaults.
INSERT INTO `__new_experiments`("id", "participant_id", "own_question_set_id", "foreign_question_set_id", "foreign_first", "foreign_stratum", "created_at") SELECT "id", "participant_id", "own_question_set_id", "foreign_question_set_id", "foreign_first", "foreign_stratum", "created_at" FROM `experiments`;--> statement-breakpoint
DROP TABLE `experiments`;--> statement-breakpoint
ALTER TABLE `__new_experiments` RENAME TO `experiments`;--> statement-breakpoint
-- Existing rows took the defaults above, but their attempts were created with real settings.
-- Copy them back so the stored pair describes the experiment that actually ran, rather than
-- defaults that would be handed to a block attached later.
UPDATE `experiments` SET
  `randomize` = coalesce((select `randomize` from `attempts` where `attempts`.`experiment_id` = `experiments`.`id` limit 1), 0),
  `countdown_hidden` = coalesce((select `countdown_hidden` from `attempts` where `attempts`.`experiment_id` = `experiments`.`id` limit 1), 0);--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_participant_unique` ON `experiments` (`participant_id`);--> statement-breakpoint
CREATE INDEX `experiments_own_set_idx` ON `experiments` (`own_question_set_id`);--> statement-breakpoint
CREATE INDEX `experiments_foreign_set_idx` ON `experiments` (`foreign_question_set_id`);