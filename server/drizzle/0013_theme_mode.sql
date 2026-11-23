ALTER TABLE "workspace_appearance" ADD COLUMN "mode" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_appearance" ADD CONSTRAINT "workspace_appearance_mode_valid" CHECK ("workspace_appearance"."mode" in ('system', 'light', 'dark'));--> statement-breakpoint
-- Version 2 themes replace the Canopy, Tide and Ember starters, and Cerulean replaces Canopy as the
-- default. A workspace that never chose a theme was using Canopy, so it gets a row that says so.
INSERT INTO "workspace_appearance" ("workspace_id", "revision", "active_id", "themes")
SELECT "installation"."workspace_id", 0, 'canopy', '[]'::jsonb FROM "installation"
WHERE "installation"."state" = 'claimed' AND "installation"."workspace_id" IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM "workspace_appearance" WHERE "workspace_appearance"."workspace_id" = "installation"."workspace_id");--> statement-breakpoint
-- A workspace using a retired starter keeps it as its own theme, still selected. The copy is the
-- version 1 file, which the server converts to version 2 as it reads it (shared/appearance/theme.mjs).
WITH "starter" ("id", "theme") AS (VALUES
	('canopy', '{"version":1,"name":"Canopy","scheme":"light","tokens":{"bg":"#eff1e4","panel":"#fafbf2","fg":"#182f24","muted":"#4a6150","accent":"#235b3f","accentInk":"#ffffff","border":"#b4c4ad","danger":"#923a27","success":"#24583b","fontBody":"system-ui","fontHeading":"Georgia"}}'::jsonb),
	('tide', '{"version":1,"name":"Tide","scheme":"light","tokens":{"bg":"#eaf2f8","panel":"#fcfeff","fg":"#122c41","muted":"#466071","accent":"#17567d","accentInk":"#ffffff","border":"#abc3d2","danger":"#963e42","success":"#1b645f","fontBody":"Avenir Next","fontHeading":"Avenir Next"}}'::jsonb),
	('ember', '{"version":1,"name":"Ember","scheme":"dark","tokens":{"bg":"#21191b","panel":"#302123","fg":"#ffeddb","muted":"#d4b5a8","accent":"#ffad74","accentInk":"#301c19","border":"#78564a","danger":"#ff9e97","success":"#a7d1a0","fontBody":"system-ui","fontHeading":"ui-monospace"}}'::jsonb)
), "copy" AS (
	SELECT "workspace_appearance"."workspace_id", 'custom-' || gen_random_uuid() AS "id", "starter"."theme"
	FROM "workspace_appearance" JOIN "starter" ON "starter"."id" = "workspace_appearance"."active_id"
)
UPDATE "workspace_appearance" SET
	"active_id" = "copy"."id",
	"themes" = "workspace_appearance"."themes" || jsonb_build_array(jsonb_build_object('id', "copy"."id", 'theme', "copy"."theme")),
	"revision" = "workspace_appearance"."revision" + 1
FROM "copy" WHERE "copy"."workspace_id" = "workspace_appearance"."workspace_id";
