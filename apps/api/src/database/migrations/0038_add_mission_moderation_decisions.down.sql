-- Reverses 0038_add_mission_moderation_decisions.
DROP TABLE IF EXISTS mission_moderation_decisions;--> statement-breakpoint
ALTER TABLE "mission_screenings" DROP CONSTRAINT IF EXISTS "mission_screenings_id_mission_unique";--> statement-breakpoint
DROP TYPE IF EXISTS mission_moderation_outcome;
