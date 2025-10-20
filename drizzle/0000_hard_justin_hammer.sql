CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"url" varchar(2048) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"finding_type" varchar(100),
	"severity" varchar(20),
	"title" varchar(512),
	"description" text,
	"detected_value" text,
	"context" text,
	"fingerprint" varchar(512),
	"false_positive" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"run_type" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"url_count" integer DEFAULT 0 NOT NULL,
	"finding_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_fingerprint_idx" ON "findings" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "findings_run_id_idx" ON "findings" USING btree ("run_id");

--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"url" varchar(2048) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"finding_type" varchar(100),
	"severity" varchar(20),
	"title" varchar(512),
	"description" text,
	"detected_value" text,
	"context" text,
	"fingerprint" varchar(512),
	"false_positive" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"run_type" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"url_count" integer DEFAULT 0 NOT NULL,
	"finding_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reverify_keys" (
	"idempotency_key" varchar(255) PRIMARY KEY NOT NULL,
	"finding_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'accepted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reverify_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_request_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverify_keys" ADD CONSTRAINT "reverify_keys_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverify_counters" ADD CONSTRAINT "reverify_counters_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_fingerprint_idx" ON "findings" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "findings_run_id_idx" ON "findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reverify_keys_expires_at_idx" ON "reverify_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "reverify_keys_finding_id_idx" ON "reverify_keys" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "reverify_counters_finding_window_idx" ON "reverify_counters" USING btree ("finding_id","window_start","window_end");--> statement-breakpoint
CREATE INDEX "reverify_counters_window_end_idx" ON "reverify_counters" USING btree ("window_end");