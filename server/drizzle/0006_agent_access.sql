CREATE TABLE "agent_binding" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"credential" text,
	"enabled_roles" text[] NOT NULL,
	"kit_digest" text NOT NULL,
	"revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_grant" (
	"app_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"roles" text[] NOT NULL,
	"ask_all_writes" boolean NOT NULL,
	"overrides" jsonb NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "agent_grant_app_id_agent_id_pk" PRIMARY KEY("app_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"verifier" text NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agent_key_verifier_unique" UNIQUE("verifier")
);
--> statement-breakpoint
CREATE TABLE "agent_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"route" text NOT NULL,
	"operation_id" text,
	"fingerprint" text,
	"input" text,
	"result" text,
	"status" text NOT NULL,
	"binding_revision" integer NOT NULL,
	"grant_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_operation" UNIQUE("agent_id","app_id","route","operation_id")
);
--> statement-breakpoint
CREATE TABLE "external_agent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_binding" ADD CONSTRAINT "agent_binding_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grant" ADD CONSTRAINT "agent_grant_app_id_agent_binding_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."agent_binding"("app_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grant" ADD CONSTRAINT "agent_grant_agent_id_external_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."external_agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_key" ADD CONSTRAINT "agent_key_agent_id_external_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."external_agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_request" ADD CONSTRAINT "agent_request_agent_id_external_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."external_agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_request" ADD CONSTRAINT "agent_request_key_id_agent_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."agent_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agent" ADD CONSTRAINT "external_agent_id_actor_id_fk" FOREIGN KEY ("id") REFERENCES "public"."actor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agent" ADD CONSTRAINT "external_agent_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agent" ADD CONSTRAINT "external_agent_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The app installer may retain its row and volumes after removal. Its authority ends immediately.
CREATE FUNCTION retire_agent_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.desired = 'removed' AND OLD.desired <> 'removed')
     OR NEW.kit IS DISTINCT FROM OLD.kit OR NEW.kit_source IS DISTINCT FROM OLD.kit_source
     OR NEW.commit IS DISTINCT FROM OLD.commit THEN
    DELETE FROM agent_grant WHERE app_id = OLD.id;
    UPDATE agent_binding SET enabled_roles='{}', credential=NULL, kit_digest='', revision=revision+1
      WHERE app_id = OLD.id;
    UPDATE agent_request SET status='stale', input=NULL, revision=revision+1
      WHERE app_id=OLD.id AND status='pending';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER app_agent_access_changed AFTER UPDATE ON app FOR EACH ROW EXECUTE FUNCTION retire_agent_binding();
