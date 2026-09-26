-- Reverses 0027_add_investigation_notes_and_tasks.
DROP TABLE IF EXISTS investigation_tasks;--> statement-breakpoint
DROP TABLE IF EXISTS investigation_notes;--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_investigation_task_record();--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_investigation_note_record();--> statement-breakpoint
DROP TYPE IF EXISTS investigation_task_status;--> statement-breakpoint
DROP TYPE IF EXISTS investigation_visibility;
