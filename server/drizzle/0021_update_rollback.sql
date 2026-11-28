-- What an update replaced, kept on its job while it runs (journey 019, decision 3), so an update that
-- doesn't start, or is interrupted by a restart, is put back. Cleared when the job ends.
ALTER TABLE "install_job" ADD COLUMN "rollback" jsonb;