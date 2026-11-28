-- The link the owner installed each app's kit from, at its branch, tag or commit (journey 019), so
-- an update check can read the kit there again. A kit file given on this machine, and an app
-- installed before, have none.
ALTER TABLE "app" ADD COLUMN "kit_link" text;