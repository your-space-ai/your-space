-- How each installed app's kit and Compose file were read from GitHub (journey 015, R4): anonymously,
-- or through the GitHub connection with the account the token belonged to. Apps installed before
-- have none.
ALTER TABLE "app" ADD COLUMN "provenance" jsonb;
