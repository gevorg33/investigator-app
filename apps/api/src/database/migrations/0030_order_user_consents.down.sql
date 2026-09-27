-- Reverses 0030_order_user_consents. Dropping the column drops its identity sequence and index.
ALTER TABLE "user_consents" DROP COLUMN IF EXISTS "seq";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_consents_user_document_idx" ON "user_consents" USING btree ("user_id","document_type","occurred_at" DESC NULLS LAST);
