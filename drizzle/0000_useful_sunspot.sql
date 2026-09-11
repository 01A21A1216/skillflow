CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_id` text,
	`summary` text NOT NULL,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_entity_idx` ON `activities` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `activity_time_idx` ON `activities` (`created_at`);--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`location` text NOT NULL,
	`current_title` text NOT NULL,
	`current_company` text NOT NULL,
	`years_experience` real DEFAULT 0 NOT NULL,
	`seniority` text DEFAULT 'mid' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`source` text NOT NULL,
	`source_detail` text,
	`referred_by_id` text,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expected_salary` integer,
	`current_salary` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notice_period_days` integer DEFAULT 14 NOT NULL,
	`work_authorization` text DEFAULT 'citizen' NOT NULL,
	`willing_to_relocate` integer DEFAULT false NOT NULL,
	`linkedin_url` text,
	`summary` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`rating` integer DEFAULT 0 NOT NULL,
	`last_contacted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`referred_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cand_email_idx` ON `candidates` (`email`);--> statement-breakpoint
CREATE INDEX `cand_owner_idx` ON `candidates` (`owner_id`);--> statement-breakpoint
CREATE INDEX `cand_status_idx` ON `candidates` (`status`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`industry` text NOT NULL,
	`location` text NOT NULL,
	`tier` text DEFAULT 'standard' NOT NULL,
	`account_owner_id` text,
	`contact_name` text,
	`contact_email` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sla_days` integer DEFAULT 21 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`interviewer_id` text NOT NULL,
	`recommendation` text NOT NULL,
	`overall` integer NOT NULL,
	`technical` integer NOT NULL,
	`communication` integer NOT NULL,
	`problem_solving` integer NOT NULL,
	`culture_fit` integer NOT NULL,
	`strengths` text DEFAULT '' NOT NULL,
	`concerns` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`submitted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_unique_idx` ON `feedback` (`interview_id`,`interviewer_id`);--> statement-breakpoint
CREATE TABLE `interview_panel` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'interviewer' NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `panel_unique_idx` ON `interview_panel` (`interview_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`mode` text DEFAULT 'video' NOT NULL,
	`scheduled_at` integer NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`location_or_link` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`organizer_id` text NOT NULL,
	`agenda` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `iv_sub_idx` ON `interviews` (`submission_id`);--> statement-breakpoint
CREATE INDEX `iv_time_idx` ON `interviews` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `iv_status_idx` ON `interviews` (`status`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `note_entity_idx` ON `notes` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`base_salary` integer NOT NULL,
	`bonus_percent` real DEFAULT 0 NOT NULL,
	`signing_bonus` integer DEFAULT 0 NOT NULL,
	`equity_units` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`start_date` text,
	`expires_at` text,
	`extended_at` integer,
	`responded_at` integer,
	`approved_by_id` text,
	`created_by_id` text NOT NULL,
	`decline_reason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offer_sub_idx` ON `offers` (`submission_id`);--> statement-breakpoint
CREATE INDEX `offer_status_idx` ON `offers` (`status`);--> statement-breakpoint
CREATE TABLE `requisition_assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`requisition_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'recruiter' NOT NULL,
	FOREIGN KEY (`requisition_id`) REFERENCES `requisitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `req_assignee_idx` ON `requisition_assignees` (`requisition_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `requisitions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`client_id` text NOT NULL,
	`hiring_manager_id` text NOT NULL,
	`lead_recruiter_id` text NOT NULL,
	`department` text NOT NULL,
	`employment_type` text NOT NULL,
	`work_mode` text NOT NULL,
	`location` text NOT NULL,
	`openings` integer DEFAULT 1 NOT NULL,
	`filled` integer DEFAULT 0 NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`seniority` text DEFAULT 'mid' NOT NULL,
	`min_salary` integer,
	`max_salary` integer,
	`bill_rate_min` integer,
	`bill_rate_max` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`experience_min` integer DEFAULT 0 NOT NULL,
	`experience_max` integer DEFAULT 10 NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`requirements` text DEFAULT '[]' NOT NULL,
	`opened_at` text NOT NULL,
	`target_fill_date` text,
	`closed_at` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hiring_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_recruiter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `req_code_idx` ON `requisitions` (`code`);--> statement-breakpoint
CREATE INDEX `req_status_idx` ON `requisitions` (`status`);--> statement-breakpoint
CREATE INDEX `req_client_idx` ON `requisitions` (`client_id`);--> statement-breakpoint
CREATE INDEX `req_recruiter_idx` ON `requisitions` (`lead_recruiter_id`);--> statement-breakpoint
CREATE TABLE `stage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`actor_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stage_event_sub_idx` ON `stage_events` (`submission_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`requisition_id` text NOT NULL,
	`stage` text DEFAULT 'sourced' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`owner_id` text NOT NULL,
	`match_score` integer DEFAULT 0 NOT NULL,
	`expected_rate` integer,
	`rejection_reason` text,
	`rejected_at` integer,
	`submitted_at` integer,
	`stage_since` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requisition_id`) REFERENCES `requisitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sub_unique_idx` ON `submissions` (`candidate_id`,`requisition_id`);--> statement-breakpoint
CREATE INDEX `sub_req_idx` ON `submissions` (`requisition_id`);--> statement-breakpoint
CREATE INDEX `sub_stage_idx` ON `submissions` (`stage`);--> statement-breakpoint
CREATE INDEX `sub_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`title` text NOT NULL,
	`department` text NOT NULL,
	`phone` text,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`accent` text DEFAULT 'indigo' NOT NULL,
	`capacity` integer DEFAULT 12 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`joined_at` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);