-- Managed repositories, deploying an app from a repository commit, the GitHub connection and a custom
-- Home are out of the alpha (decision 2026-11-23). These tables held repository
-- registrations, agents' repository grants, replacement previews, the owner's GitHub token and
-- pending device authorization, the chosen Home app and its read grants, and the times of its last
-- reads. No app's data, settings or credential is in them, so dropping them is safe: apps keep
-- running and a workspace opens the built-in Home. The GitHub token is only deleted here; the owner
-- revokes the authorization at GitHub.
--
-- A deployment from a repository that never finished (its replacement still 'applying') recorded the
-- new source on the app before switching it, and only the replacement kept the version before it.
-- Your Space can no longer resume one, so the app goes back to that earlier version, which ran
-- before, and waits failed until the owner starts it: nothing starts it by itself, and an app whose
-- earlier containers still run is reported with the source they run.
UPDATE "app" SET
  "source_url" = r."original"->>'sourceUrl', "repo" = r."original"->>'repo', "path" = r."original"->>'path',
  "ref" = r."original"->>'ref', "commit" = r."original"->>'commit', "compose" = r."original"->>'compose',
  "kit" = NULLIF(r."original"->'kit', 'null'::jsonb), "kit_source" = r."original"->>'kitSource',
  "images" = r."original"->'images', "adaptations" = r."original"->'adaptations',
  "state" = 'failed',
  "state_reason" = 'A deployment from a repository was interrupted, so this app went back to the version before it. Start the app to run that version.',
  "updated_at" = now()
FROM (
  SELECT DISTINCT ON ("app_id") "app_id", "original" FROM "app_replacement"
  WHERE "state" = 'applying' AND "original" ?& array['sourceUrl','repo','path','ref','commit','compose','images','adaptations']
  ORDER BY "app_id", "created_at" DESC
) r
WHERE "app"."id" = r."app_id" AND "app"."state" <> 'removed';--> statement-breakpoint
-- Any other app left failed with the reason that pointed at resuming its deployment.
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
