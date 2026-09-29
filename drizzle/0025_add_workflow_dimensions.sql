ALTER TABLE `question_sets` ADD `api_key_payer` text DEFAULT 'creator' NOT NULL;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `material_uploader` text DEFAULT 'creator' NOT NULL;--> statement-breakpoint
ALTER TABLE `study_templates` ADD `api_key_payer` text DEFAULT 'creator' NOT NULL;--> statement-breakpoint
ALTER TABLE `study_templates` ADD `material_uploader` text DEFAULT 'creator' NOT NULL;--> statement-breakpoint
ALTER TABLE `study_templates` ADD `material_file_name` text;--> statement-breakpoint
ALTER TABLE `study_templates` ADD `material_contributions` text;--> statement-breakpoint
UPDATE `question_sets`
SET
  `api_key_payer` = CASE WHEN `workflow_type` = 'conference' THEN 'taker' ELSE 'creator' END,
  `material_uploader` = CASE WHEN `workflow_type` = 'conference' THEN 'taker' ELSE 'creator' END;--> statement-breakpoint
UPDATE `study_templates`
SET
  `api_key_payer` = CASE WHEN `workflow_type` = 'conference' THEN 'taker' ELSE 'creator' END,
  `material_uploader` = CASE WHEN `workflow_type` = 'conference' THEN 'taker' ELSE 'creator' END;