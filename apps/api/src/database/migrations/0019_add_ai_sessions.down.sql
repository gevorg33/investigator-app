-- Reverses 0019_add_ai_sessions.
DROP TABLE IF EXISTS ai_messages;--> statement-breakpoint
DROP TABLE IF EXISTS ai_sessions;--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_deleted_session_empty();--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_ai_message_change();--> statement-breakpoint
DROP TYPE IF EXISTS ai_message_kind;--> statement-breakpoint
DROP TYPE IF EXISTS ai_message_role;
