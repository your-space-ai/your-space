ALTER TABLE "workspace_appearance" ADD COLUMN "mode" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_appearance" ADD CONSTRAINT "workspace_appearance_mode_valid" CHECK ("workspace_appearance"."mode" in ('system', 'light', 'dark'));--> statement-breakpoint
-- Themes have one format, version 2, and Cerulean, Cinder and Fern replace the version 1 starters.
-- Every catalog saved before this migration holds version 1 themes or a starter's id, so it starts
-- over on the default theme. The revision still moves forward, so a page opened before the upgrade
-- gets a conflict instead of overwriting the new catalog.
UPDATE "workspace_appearance" SET "active_id" = 'cerulean', "themes" = '[]'::jsonb, "revision" = "revision" + 1;
