-- Managed repositories and deploying an app from a repository commit (journey 011) are out of the
-- first release (decision 2026-11-23). These tables held only repository registrations, agents'
-- repository grants and replacement previews. Apps keep their sources, settings and data, and the
-- GitHub connection stays. An interrupted replacement had already recorded its reviewed source on
-- the app; one whose recovery failed left the app failed with a reason that pointed at resuming it,
-- which Your Space can no longer do, so that reason now says to start the app.
UPDATE "app" SET "state_reason" = 'A deployment from a repository was interrupted. Start the app to run the version it recorded.'
  WHERE "state" = 'failed' AND "state_reason" = 'Managed deployment was interrupted. Resume the same deployment to recover.';--> statement-breakpoint
DROP TABLE "app_replacement" CASCADE;--> statement-breakpoint
DROP TABLE "managed_repository" CASCADE;--> statement-breakpoint
DROP TABLE "repository_grant" CASCADE;