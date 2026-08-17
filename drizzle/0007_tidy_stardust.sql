CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`own_question_set_id` text NOT NULL,
	`foreign_question_set_id` text NOT NULL,
	`foreign_first` integer NOT NULL,
	`foreign_stratum` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`own_question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`foreign_question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_participant_unique` ON `experiments` (`participant_id`);--> statement-breakpoint
CREATE INDEX `experiments_own_set_idx` ON `experiments` (`own_question_set_id`);--> statement-breakpoint
CREATE INDEX `experiments_foreign_set_idx` ON `experiments` (`foreign_question_set_id`);--> statement-breakpoint
ALTER TABLE `attempts` ADD `experiment_id` text REFERENCES experiments(id);--> statement-breakpoint
ALTER TABLE `attempts` ADD `condition` text;--> statement-breakpoint
CREATE INDEX `attempts_experiment_idx` ON `attempts` (`experiment_id`);