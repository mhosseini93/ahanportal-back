CREATE TABLE "attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attributes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"crm_id" text,
	"legacy_id" integer,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_by" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_types_crm_id_unique" UNIQUE("crm_id"),
	CONSTRAINT "product_types_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "product_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_type_id" integer NOT NULL,
	"crm_id" text,
	"legacy_id" integer,
	"code" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'publish' NOT NULL,
	"price" bigint,
	"price_updated_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_crm_id_unique" UNIQUE("crm_id"),
	CONSTRAINT "products_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_parent_id_product_types_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."product_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_types_parent_idx" ON "product_types" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "products_type_idx" ON "products" USING btree ("product_type_id");