-- Reverses 0039_add_mission_tags. Tags are refinement only: nothing outside these tables reads them.
DROP TABLE IF EXISTS mission_tags;--> statement-breakpoint
DROP TABLE IF EXISTS tag_labels;--> statement-breakpoint
DROP TABLE IF EXISTS tags;--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_tag_identity();--> statement-breakpoint
DROP TYPE IF EXISTS tag_status;
