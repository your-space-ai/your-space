-- Managed repositories and deploying an app from a repository commit (journey 011) are out of the
-- first release (decision 2026-11-23). These tables held only repository registrations, agents'
-- repository grants and replacement previews. Apps, their settings and data, and the GitHub
-- connection are untouched.
DROP TABLE "app_replacement" CASCADE;--> statement-breakpoint
DROP TABLE "managed_repository" CASCADE;--> statement-breakpoint
DROP TABLE "repository_grant" CASCADE;