CREATE TABLE "category_price_list_products" (
	"category_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	CONSTRAINT "category_price_list_products_category_id_product_id_pk" PRIMARY KEY("category_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "category_price_list_products" ADD CONSTRAINT "category_price_list_products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_price_list_products" ADD CONSTRAINT "category_price_list_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_price_list_products_product_idx" ON "category_price_list_products" USING btree ("product_id");