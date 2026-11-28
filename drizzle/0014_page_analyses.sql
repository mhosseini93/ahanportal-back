CREATE TABLE "analysis_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"writer" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"result" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"paragraphs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text,
	"signature" text,
	"facts" jsonb,
	"status" text DEFAULT 'ok' NOT NULL,
	"status_reason" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"locked" text,
	"locked_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analysis_runs_started_idx" ON "analysis_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "page_analyses_target_idx" ON "page_analyses" USING btree ("target_type","target_id");