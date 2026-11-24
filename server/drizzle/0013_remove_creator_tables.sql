-- Managed repositories, deploying an app from a repository commit, the GitHub connection and a custom
-- Home are out of the first release (decision 2026-11-23). These tables held repository
-- registrations, agents' repository grants, replacement previews, the owner's GitHub token and
-- pending device authorization, the chosen Home app and its read grants, and the times of its last
-- reads. No app's data, settings or credential is in them, so dropping them is safe: apps keep
-- running and a workspace opens the built-in Home. The GitHub token is only deleted here; the owner
-- revokes the authorization at GitHub.
--
-- An interrupted replacement had already recorded its reviewed source on the app; one whose
-- recovery failed left the app failed with a reason that pointed at resuming it, which Your Space can
-- no longer do, so that reason now says to start the app.
UPDATE "app" SET "state_reason" = 'A deployment from a repository was interrupted. Start the app to run the version it recorded.'
  WHERE "state" = 'failed' AND "state_reason" = 'Managed deployment was interrupted. Resume the same deployment to recover.';--> statement-breakpoint
-- The custom Home's trigger on app writes to workspace_home, so it goes before the table; dropping
-- the table alone would leave every later change to an app failing.
DROP TRIGGER IF EXISTS "app_home_changed" ON "app";--> statement-breakpoint
DROP FUNCTION IF EXISTS retire_custom_home();--> statement-breakpoint
DROP TABLE "app_replacement" CASCADE;--> statement-breakpoint
DROP TABLE "github_connection" CASCADE;--> statement-breakpoint
DROP TABLE "github_device" CASCADE;--> statement-breakpoint
DROP TABLE "home_read_activity" CASCADE;--> statement-breakpoint
DROP TABLE "managed_repository" CASCADE;--> statement-breakpoint
DROP TABLE "repository_grant" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_home" CASCADE;
