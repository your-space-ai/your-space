CREATE TABLE "owner_layout" (
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"app_order" jsonb NOT NULL,
	"views" jsonb NOT NULL,
	CONSTRAINT "owner_layout_workspace_id_owner_id_pk" PRIMARY KEY("workspace_id","owner_id")
);
--> statement-breakpoint
ALTER TABLE "owner_layout" ADD CONSTRAINT "owner_layout_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_layout" ADD CONSTRAINT "owner_layout_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;