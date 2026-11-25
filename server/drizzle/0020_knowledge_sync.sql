CREATE TABLE "google_connection" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"token" text,
	"problem" text,
	"connected_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_connection_single_row" CHECK ("google_connection"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge_sync" (
	"knowledge_base_id" uuid PRIMARY KEY NOT NULL,
	"folder_id" text NOT NULL,
	"connected_by" uuid NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resync" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"result" text,
	"reason" text,
	"side" text,
	"message" text,
	"deletions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job" jsonb,
	"requested" jsonb,
	CONSTRAINT "knowledge_sync_result_valid" CHECK ("knowledge_sync"."result" is null or "knowledge_sync"."result" in ('synced', 'stopped', 'unauthorized', 'failed')),
	CONSTRAINT "knowledge_sync_side_valid" CHECK ("knowledge_sync"."side" is null or "knowledge_sync"."side" in ('local', 'remote'))
);
--> statement-breakpoint
ALTER TABLE "google_connection" ADD CONSTRAINT "google_connection_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sync" ADD CONSTRAINT "knowledge_sync_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sync" ADD CONSTRAINT "knowledge_sync_connected_by_actor_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;