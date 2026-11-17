DROP TABLE "price_list_products" CASCADE;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "price_list_columns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "price_list_group_by" text;