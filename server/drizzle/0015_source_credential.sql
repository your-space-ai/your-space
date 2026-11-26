-- The GitHub connection returns, read only (journey 015, decision 2026-11-25): one source credential
-- per workspace, a fine-grained token the owner pastes, encrypted under the data key. The server
-- moves it onto a new data key when it starts after a rotation (server/src/apps/keys.ts).
CREATE TABLE "source_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token" text NOT NULL,
	"account" text NOT NULL,
	"worked_at" timestamp with time zone NOT NULL,
	"refused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_credential_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "source_credential" ADD CONSTRAINT "source_credential_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;