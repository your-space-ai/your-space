CREATE TABLE "github_connection" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"github_user_id" text NOT NULL,
	"login" text NOT NULL,
	"credential" text NOT NULL,
	"scope" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_device" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"device_code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"next_poll_at" timestamp with time zone NOT NULL,
	"interval_seconds" integer NOT NULL,
	"scope" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_repository" (
	"owner_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"full_name" text NOT NULL,
	"origin" text NOT NULL,
	"default_branch" text NOT NULL,
	"private" boolean NOT NULL,
	CONSTRAINT "managed_repository_owner_id_account_id_repo_id_pk" PRIMARY KEY("owner_id","account_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "repository_grant" (
	"owner_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"can_create" boolean NOT NULL,
	"can_fork" boolean NOT NULL,
	"repo_ids" text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "repository_grant_owner_id_account_id_agent_id_pk" PRIMARY KEY("owner_id","account_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "github_connection" ADD CONSTRAINT "github_connection_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_device" ADD CONSTRAINT "github_device_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_repository" ADD CONSTRAINT "managed_repository_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_grant" ADD CONSTRAINT "repository_grant_owner_id_github_connection_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."github_connection"("owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_grant" ADD CONSTRAINT "repository_grant_agent_id_external_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."external_agent"("id") ON DELETE cascade ON UPDATE no action;