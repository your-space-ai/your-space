CREATE TABLE "workspace_appearance" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"active_id" text NOT NULL,
	"themes" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_appearance" ADD CONSTRAINT "workspace_appearance_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;