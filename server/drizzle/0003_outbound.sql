CREATE TABLE "app_access_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"host" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_access_request_app_host" UNIQUE("app_id","host")
);
--> statement-breakpoint
CREATE TABLE "app_outbound" (
	"app_id" uuid NOT NULL,
	"host" text NOT NULL,
	"source" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_outbound_app_id_host_pk" PRIMARY KEY("app_id","host")
);
--> statement-breakpoint
ALTER TABLE "app_access_request" ADD CONSTRAINT "app_access_request_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_outbound" ADD CONSTRAINT "app_outbound_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_outbound" ADD CONSTRAINT "app_outbound_approved_by_actor_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;