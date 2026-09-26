-- Reverses 0025_order_mission_history. Dropping the column drops its identity sequence and index.
ALTER TABLE "mission_status_history" DROP COLUMN IF EXISTS "seq";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_status_history_mission_idx" ON "mission_status_history" USING btree ("mission_id","occurred_at");
