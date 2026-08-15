CREATE TABLE `question_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`paper_name` text NOT NULL,
	`contributions` text NOT NULL,
	`model_id` text NOT NULL,
	`pdf_engine` text NOT NULL,
	`config_json` text NOT NULL,
	`questions_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`question_set_id` text NOT NULL,
	`randomize` integer DEFAULT false NOT NULL,
	`question_order_json` text NOT NULL,
	`current_index` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`score` real,
	`grading_json` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_question_set_idx` ON `attempts` (`question_set_id`);
--> statement-breakpoint
CREATE TABLE `attempt_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_type` text NOT NULL,
	`answer_json` text,
	`started_at` text NOT NULL,
	`submitted_at` text,
	`duration_ms` integer,
	`score` real,
	`feedback_json` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_answers_attempt_question_unique` ON `attempt_answers` (`attempt_id`,`question_id`);
--> statement-breakpoint
CREATE INDEX `attempt_answers_attempt_idx` ON `attempt_answers` (`attempt_id`);
