-- Reverse of 0001. db-migration requires every migration to have a working down path.
--
-- Grants go before the table: dropping the table takes its grants with it, but the
-- explicit REVOKE keeps the down path correct if the drop is ever made conditional.
REVOKE ALL ON user_tokens FROM investigator_app;--> statement-breakpoint

DROP TABLE IF EXISTS "user_tokens";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."user_token_purpose";
