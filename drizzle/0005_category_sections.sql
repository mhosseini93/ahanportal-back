CREATE TABLE "category_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"product_type_id" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"include_subtypes" boolean DEFAULT true NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"excluded_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_by" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_sections" ADD CONSTRAINT "category_sections_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_sections" ADD CONSTRAINT "category_sections_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_sections_category_idx" ON "category_sections" USING btree ("category_id");