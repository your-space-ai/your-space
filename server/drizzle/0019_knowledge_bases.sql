CREATE TABLE "app_knowledge_base" (
	"app_id" uuid NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_knowledge_base_app_id_knowledge_base_id_pk" PRIMARY KEY("app_id","knowledge_base_id")
);
--> statement-breakpoint
CREATE TABLE "event_knowledge_base" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"knowledge_base_id" uuid,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_base_name_unique" UNIQUE("name"),
	CONSTRAINT "knowledge_base_name_valid" CHECK ("knowledge_base"."name" ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$')
);
--> statement-breakpoint
ALTER TABLE "app_knowledge_base" ADD CONSTRAINT "app_knowledge_base_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_knowledge_base" ADD CONSTRAINT "app_knowledge_base_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_knowledge_base" ADD CONSTRAINT "app_knowledge_base_granted_by_actor_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_knowledge_base" ADD CONSTRAINT "event_knowledge_base_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_knowledge_base" ADD CONSTRAINT "event_knowledge_base_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;