ALTER TABLE "candidates" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "erased_by" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "erasure_reason" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "retention_consent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "cand_erased_idx" ON "candidates" USING btree ("erased_at");