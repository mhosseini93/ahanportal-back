CREATE TABLE "price_list_products" (
	"product_type_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	CONSTRAINT "price_list_products_product_type_id_product_id_pk" PRIMARY KEY("product_type_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "price_list_products" ADD CONSTRAINT "price_list_products_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_products" ADD CONSTRAINT "price_list_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_list_products_product_idx" ON "price_list_products" USING btree ("product_id");