ALTER TABLE `question_sets` ADD `share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `question_sets_share_token_unique` ON `question_sets` (`share_token`);