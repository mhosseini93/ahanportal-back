ALTER TABLE "categories" ADD COLUMN "filter_keys" jsonb;--> statement-breakpoint
ALTER TABLE "category_sections" ADD COLUMN "sort" text DEFAULT 'columns' NOT NULL;