-- Reverses 0023_add_mission_browse. Dropping the table drops its trigger and policy with it.
DROP TABLE IF EXISTS saved_mission_searches;--> statement-breakpoint
DROP TRIGGER IF EXISTS missions_published_at ON missions;--> statement-breakpoint
DROP FUNCTION IF EXISTS set_mission_published_at();--> statement-breakpoint
DROP INDEX IF EXISTS missions_location_gist;--> statement-breakpoint
DROP INDEX IF EXISTS missions_published_idx;--> statement-breakpoint
ALTER TABLE missions DROP COLUMN IF EXISTS published_at;
