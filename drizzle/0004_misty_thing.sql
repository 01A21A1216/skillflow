ALTER TABLE "candidates" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(current_title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(current_company, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(primary_technology, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(skills::text, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(email, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(location, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(tags::text, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(summary, '')), 'D')
    ) STORED;--> statement-breakpoint
ALTER TABLE "requisitions" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(code, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(department, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(required_skills::text, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(preferred_skills::text, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(location, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'D')
    ) STORED;--> statement-breakpoint
CREATE INDEX "cand_search_idx" ON "candidates" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "cand_skills_idx" ON "candidates" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "req_search_idx" ON "requisitions" USING gin ("search_vector");