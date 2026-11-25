-- The GitHub connection's optional image token (journey 015, decision 4): the workspace's registry
-- credential, a classic token with only read:packages, encrypted under the data key, which the engine
-- signs in to ghcr.io with to pull a private image. The server moves it onto a new data key when it
-- starts after a rotation (server/src/apps/keys.ts).
CREATE TABLE "registry_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token" text NOT NULL,
	"account" text NOT NULL,
	"worked_at" timestamp with time zone NOT NULL,
	"refused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_credential_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "registry_credential" ADD CONSTRAINT "registry_credential_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;