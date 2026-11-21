CREATE TABLE "app_replacement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"repo_id" text NOT NULL,
	"base_fingerprint" text NOT NULL,
	"original" jsonb NOT NULL,
	"candidate" jsonb NOT NULL,
	"state" text DEFAULT 'preview' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_replacement" ADD CONSTRAINT "app_replacement_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_replacement" ADD CONSTRAINT "app_replacement_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_replacement_installation" ON "app_replacement" USING btree ("app_id","created_at");
--> statement-breakpoint
-- A different Compose file at the same commit can still replace what executes under the app ID.
CREATE OR REPLACE FUNCTION retire_agent_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.desired = 'removed' AND OLD.desired <> 'removed')
     OR NEW.kit IS DISTINCT FROM OLD.kit OR NEW.kit_source IS DISTINCT FROM OLD.kit_source
     OR NEW.commit IS DISTINCT FROM OLD.commit OR NEW.compose IS DISTINCT FROM OLD.compose
     OR NEW.source_url IS DISTINCT FROM OLD.source_url OR NEW.images IS DISTINCT FROM OLD.images THEN
    DELETE FROM agent_grant WHERE app_id = OLD.id;
    UPDATE agent_binding SET enabled_roles='{}', credential=NULL, kit_digest='', credential_revision=revision+1, revision=revision+1
      WHERE app_id = OLD.id;
    UPDATE agent_request SET status='stale', input=NULL, revision=revision+1
      WHERE app_id=OLD.id AND status='pending';
  END IF;
  RETURN NEW;
END
$$;
