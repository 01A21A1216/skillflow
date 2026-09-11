CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"summary" text NOT NULL,
	"changes" jsonb,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text DEFAULT 'document' NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"digest" text DEFAULT '' NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "candidate_education" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"institution" text NOT NULL,
	"qualification" text NOT NULL,
	"field" text DEFAULT '' NOT NULL,
	"start_year" integer,
	"end_year" integer,
	"grade" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_experience" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"started_on" text NOT NULL,
	"ended_on" text,
	"summary" text DEFAULT '' NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"location" text NOT NULL,
	"current_title" text NOT NULL,
	"current_company" text NOT NULL,
	"years_experience" real DEFAULT 0 NOT NULL,
	"seniority" text DEFAULT 'mid' NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_technology" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"source_detail" text,
	"referred_by_id" text,
	"owner_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expected_salary" integer,
	"current_salary" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notice_period_days" integer DEFAULT 14 NOT NULL,
	"availability" text DEFAULT 'one_month' NOT NULL,
	"available_from" text,
	"expected_rate" integer,
	"rate_basis" text DEFAULT 'hourly' NOT NULL,
	"work_authorization" text DEFAULT 'citizen' NOT NULL,
	"willing_to_relocate" boolean DEFAULT false NOT NULL,
	"linkedin_url" text,
	"summary" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rating" integer DEFAULT 0 NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"industry" text NOT NULL,
	"location" text NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"account_owner_id" text,
	"contact_name" text,
	"contact_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sla_days" integer DEFAULT 21 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"submission_id" text,
	"channel" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"follow_up_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"logged_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"interviewer_id" text NOT NULL,
	"recommendation" text NOT NULL,
	"overall" integer NOT NULL,
	"template_id" text,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"strengths" text DEFAULT '' NOT NULL,
	"concerns" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_panel" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'interviewer' NOT NULL,
	"feedback_status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"mode" text DEFAULT 'video' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"location_or_link" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"organizer_id" text NOT NULL,
	"feedback_due_at" timestamp with time zone,
	"agenda" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text,
	"actor_id" text,
	"entity_type" text,
	"entity_id" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"base_salary" integer NOT NULL,
	"bonus_percent" real DEFAULT 0 NOT NULL,
	"signing_bonus" integer DEFAULT 0 NOT NULL,
	"equity_units" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"start_date" text,
	"expires_at" text,
	"extended_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"approved_by_id" text,
	"created_by_id" text NOT NULL,
	"decline_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"tone" text DEFAULT 'slate' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sla_days" integer DEFAULT 5 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisition_assignees" (
	"id" text PRIMARY KEY NOT NULL,
	"requisition_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'recruiter' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"client_id" text NOT NULL,
	"hiring_manager_id" text NOT NULL,
	"lead_recruiter_id" text NOT NULL,
	"scorecard_template_id" text,
	"backup_recruiter_id" text,
	"source" text DEFAULT 'client_direct' NOT NULL,
	"department" text NOT NULL,
	"employment_type" text NOT NULL,
	"work_mode" text NOT NULL,
	"location" text NOT NULL,
	"openings" integer DEFAULT 1 NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"seniority" text DEFAULT 'mid' NOT NULL,
	"min_salary" integer,
	"max_salary" integer,
	"bill_rate_min" integer,
	"bill_rate_max" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"experience_min" integer DEFAULT 0 NOT NULL,
	"experience_max" integer DEFAULT 10 NOT NULL,
	"required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visa_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" text NOT NULL,
	"target_fill_date" text,
	"closed_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"role_key" text NOT NULL,
	"permission_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rank" integer DEFAULT 100 NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecard_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecard_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"actor_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"requisition_id" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_id" text NOT NULL,
	"match_score" integer DEFAULT 0 NOT NULL,
	"expected_rate" integer,
	"rejection_reason" text,
	"rejected_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"stage_since" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"department" text NOT NULL,
	"phone" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"accent" text DEFAULT 'indigo' NOT NULL,
	"capacity" integer DEFAULT 12 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"joined_at" text NOT NULL,
	"password_hash" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_experience" ADD CONSTRAINT "candidate_experience_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_referred_by_id_users_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_owner_id_users_id_fk" FOREIGN KEY ("account_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_logged_by_id_users_id_fk" FOREIGN KEY ("logged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_interviewer_id_users_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_template_id_scorecard_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."scorecard_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel" ADD CONSTRAINT "interview_panel_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel" ADD CONSTRAINT "interview_panel_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_assignees" ADD CONSTRAINT "requisition_assignees_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_assignees" ADD CONSTRAINT "requisition_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_hiring_manager_id_users_id_fk" FOREIGN KEY ("hiring_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_lead_recruiter_id_users_id_fk" FOREIGN KEY ("lead_recruiter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_backup_recruiter_id_users_id_fk" FOREIGN KEY ("backup_recruiter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_criteria" ADD CONSTRAINT "scorecard_criteria_template_id_scorecard_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."scorecard_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "activities" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_time_idx" ON "activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_actor_idx" ON "activities" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "activity_type_idx" ON "activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "att_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "att_deleted_idx" ON "attachments" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "edu_cand_idx" ON "candidate_education" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "exp_cand_idx" ON "candidate_experience" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cand_email_idx" ON "candidates" USING btree ("email");--> statement-breakpoint
CREATE INDEX "cand_owner_idx" ON "candidates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cand_status_idx" ON "candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cand_deleted_idx" ON "candidates" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "client_deleted_idx" ON "clients" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "comm_candidate_idx" ON "communications" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "comm_followup_idx" ON "communications" USING btree ("follow_up_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_unique_idx" ON "feedback" USING btree ("interview_id","interviewer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "panel_unique_idx" ON "interview_panel" USING btree ("interview_id","user_id");--> statement-breakpoint
CREATE INDEX "panel_feedback_idx" ON "interview_panel" USING btree ("feedback_status");--> statement-breakpoint
CREATE INDEX "iv_sub_idx" ON "interviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "iv_time_idx" ON "interviews" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "iv_status_idx" ON "interviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "iv_deleted_idx" ON "interviews" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "note_entity_idx" ON "notes" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "note_deleted_idx" ON "notes" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_idx" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_inbox_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "offer_sub_idx" ON "offers" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "offer_status_idx" ON "offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offer_deleted_idx" ON "offers" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_key_idx" ON "pipeline_stages" USING btree ("key");--> statement-breakpoint
CREATE INDEX "stage_position_idx" ON "pipeline_stages" USING btree ("position");--> statement-breakpoint
CREATE UNIQUE INDEX "req_assignee_idx" ON "requisition_assignees" USING btree ("requisition_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "req_code_idx" ON "requisitions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "req_status_idx" ON "requisitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "req_client_idx" ON "requisitions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "req_recruiter_idx" ON "requisitions" USING btree ("lead_recruiter_id");--> statement-breakpoint
CREATE INDEX "req_deleted_idx" ON "requisitions" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permission_idx" ON "role_permissions" USING btree ("role_key","permission_key");--> statement-breakpoint
CREATE INDEX "role_permission_role_idx" ON "role_permissions" USING btree ("role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "criteria_unique_idx" ON "scorecard_criteria" USING btree ("template_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_name_idx" ON "scorecard_templates" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stage_event_sub_idx" ON "stage_events" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_unique_idx" ON "submissions" USING btree ("candidate_id","requisition_id");--> statement-breakpoint
CREATE INDEX "sub_req_idx" ON "submissions" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "sub_stage_idx" ON "submissions" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "sub_status_idx" ON "submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sub_deleted_idx" ON "submissions" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_deleted_idx" ON "users" USING btree ("deleted_at");