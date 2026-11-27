CREATE TABLE "agent_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"name" text NOT NULL,
	"credential" text NOT NULL,
	CONSTRAINT "agent_credential_name" UNIQUE("app_id","name")
);
--> statement-breakpoint
ALTER TABLE "agent_credential" ADD CONSTRAINT "agent_credential_app_id_agent_binding_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."agent_binding"("app_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Each bound credential moves to a row named by its kit's binding, and leaves agent_binding.
INSERT INTO "agent_credential" ("app_id", "name", "credential")
  SELECT b.app_id, a.kit->'agentAccess'->'credential'->>'binding', b.credential
  FROM agent_binding b JOIN app a ON a.id = b.app_id
  WHERE b.credential IS NOT NULL AND a.kit->'agentAccess'->'credential'->>'binding' IS NOT NULL;
--> statement-breakpoint
UPDATE agent_binding SET credential = NULL WHERE credential IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION retire_agent_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.desired = 'removed' AND OLD.desired <> 'removed')
     OR NEW.kit IS DISTINCT FROM OLD.kit OR NEW.kit_source IS DISTINCT FROM OLD.kit_source
     OR NEW.commit IS DISTINCT FROM OLD.commit OR NEW.compose IS DISTINCT FROM OLD.compose
     OR NEW.source_url IS DISTINCT FROM OLD.source_url OR NEW.images IS DISTINCT FROM OLD.images THEN
    DELETE FROM agent_grant WHERE app_id = OLD.id;
    DELETE FROM agent_credential WHERE app_id = OLD.id;
    UPDATE agent_binding SET enabled_roles='{}', credential=NULL, kit_digest='', credential_revision=revision+1, revision=revision+1
      WHERE app_id = OLD.id;
    UPDATE agent_request SET status='stale', input=NULL, revision=revision+1
      WHERE app_id=OLD.id AND status='pending';
  END IF;
  RETURN NEW;
END
$$;
