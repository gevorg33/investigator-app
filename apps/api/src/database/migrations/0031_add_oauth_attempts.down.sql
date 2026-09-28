-- Reverses 0031_add_oauth_attempts.
REVOKE ALL ON oauth_attempts FROM investigator_app;--> statement-breakpoint
DROP TABLE IF EXISTS "oauth_attempts";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."oauth_intent";
