-- Each app's last update check (journey 019, decision 4): opening the app's page checks it again only
-- once this is over 12 hours old, and the Apps list shows what it found.
ALTER TABLE "app" ADD COLUMN "update_check" jsonb;