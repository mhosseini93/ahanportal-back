ALTER TABLE "categories" DROP CONSTRAINT "categories_parent_id_categories_id_fk";
--> statement-breakpoint
DROP INDEX "categories_parent_idx";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "parent_id";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "show_in_menu";