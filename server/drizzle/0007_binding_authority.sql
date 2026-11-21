ALTER TABLE "agent_binding" ADD COLUMN "credential_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_denied_samples" ON "agent_request" USING btree ("agent_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "agent_request"."status" = 'denied';
--> statement-breakpoint
-- Existing earlier bindings did not track credential changes separately. Preserve
-- receipts admitted at the current revision without trusting unknown older authority.
UPDATE agent_binding SET credential_revision=revision;
