CREATE TABLE "home_read_activity" (
	"home_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"action" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"last_read" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_read_activity_home_id_target_id_action_pk" PRIMARY KEY("home_id","target_id","action")
);
--> statement-breakpoint
CREATE TABLE "workspace_home" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"selected_id" uuid,
	"generation" text,
	"revision" integer NOT NULL,
	"grants" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "home_read_activity" ADD CONSTRAINT "home_read_activity_home_id_app_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_read_activity" ADD CONSTRAINT "home_read_activity_target_id_app_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_read_activity" ADD CONSTRAINT "home_read_activity_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_home" ADD CONSTRAINT "workspace_home_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_home" ADD CONSTRAINT "workspace_home_selected_id_app_id_fk" FOREIGN KEY ("selected_id") REFERENCES "public"."app"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A retained app UUID can be used by a later install. A Home must be chosen and granted again
-- after its source, interface or publishing authority changes, even if it later changes back.
CREATE FUNCTION retire_custom_home() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE workspace_home SET selected_id=NULL,generation=NULL,grants='[]',revision=revision+1 WHERE selected_id=OLD.id;
    RETURN OLD;
  END IF;
  IF (NEW.desired = 'removed' AND OLD.desired <> 'removed') OR NEW.kit IS DISTINCT FROM OLD.kit
    OR NEW.kit_source IS DISTINCT FROM OLD.kit_source OR NEW.commit IS DISTINCT FROM OLD.commit
    OR NEW.source_url IS DISTINCT FROM OLD.source_url OR NEW.compose IS DISTINCT FROM OLD.compose
    OR NEW.images IS DISTINCT FROM OLD.images OR NEW.interface IS DISTINCT FROM OLD.interface OR NEW.publish IS DISTINCT FROM OLD.publish
    OR NEW.frame IS DISTINCT FROM OLD.frame OR NEW.pane IS DISTINCT FROM OLD.pane THEN
    UPDATE workspace_home SET selected_id=NULL,generation=NULL,grants='[]',revision=revision+1 WHERE selected_id=OLD.id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER app_home_changed BEFORE DELETE OR UPDATE OF desired,kit,kit_source,commit,interface,publish,frame,pane
ON app FOR EACH ROW EXECUTE FUNCTION retire_custom_home();
