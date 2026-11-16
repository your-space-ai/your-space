CREATE TABLE "app" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"repo" text NOT NULL,
	"path" text NOT NULL,
	"ref" text NOT NULL,
	"commit" text NOT NULL,
	"compose" text NOT NULL,
	"kit" jsonb,
	"kit_source" text,
	"images" jsonb NOT NULL,
	"adaptations" jsonb NOT NULL,
	"interface" jsonb,
	"pane" boolean DEFAULT true NOT NULL,
	"limits" jsonb NOT NULL,
	"desired" text DEFAULT 'running' NOT NULL,
	"state" text DEFAULT 'installing' NOT NULL,
	"state_reason" text,
	"installed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "app_name_unique" UNIQUE("name"),
	CONSTRAINT "app_name_valid" CHECK ("app"."name" ~ '^[a-z][a-z0-9-]{0,29}$'),
	CONSTRAINT "app_desired_valid" CHECK ("app"."desired" in ('running', 'stopped', 'removed')),
	CONSTRAINT "app_state_valid" CHECK ("app"."state" in ('installing', 'starting', 'running', 'degraded', 'stopped', 'failed', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"app_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" text,
	"secret" boolean DEFAULT false NOT NULL,
	"generated" boolean DEFAULT false NOT NULL,
	"published_default" text,
	CONSTRAINT "app_setting_app_id_name_pk" PRIMARY KEY("app_id","name")
);
--> statement-breakpoint
CREATE TABLE "install_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "subject_app_id" uuid;--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_installed_by_actor_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_job" ADD CONSTRAINT "install_job_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_subject_app_id_app_id_fk" FOREIGN KEY ("subject_app_id") REFERENCES "public"."app"("id") ON DELETE set null ON UPDATE no action;