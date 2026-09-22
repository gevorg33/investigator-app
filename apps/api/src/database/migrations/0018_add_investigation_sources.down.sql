-- Reverses 0018_add_investigation_sources.
DROP TABLE IF EXISTS investigation_sources;--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_investigation_source_record();--> statement-breakpoint
DROP TYPE IF EXISTS source_reliability;--> statement-breakpoint
DROP TYPE IF EXISTS investigation_source_type;
