ALTER TABLE "product_types" ADD COLUMN "name_parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "name_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "crm_active" boolean DEFAULT true NOT NULL;