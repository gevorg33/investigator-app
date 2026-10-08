-- Reverses 0046_add_session_context. Dropping the tables takes their triggers and policies with
-- them. Destructive once a summary or an entity reference exists — though neither is the record:
-- the messages they were derived from stay in ai_messages (db-migration).
DROP TABLE IF EXISTS ai_session_summaries;--> statement-breakpoint
DROP TABLE IF EXISTS ai_session_entities;--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_ai_session_summary_change();
