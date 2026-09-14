-- Reverse of 0002. db-migration requires every migration to have a working down path.
REVOKE ALL ON user_identities FROM investigator_app;--> statement-breakpoint

DROP TABLE IF EXISTS "user_identities";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."identity_provider";
