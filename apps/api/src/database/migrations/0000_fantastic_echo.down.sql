-- Reverse of 0000. db-migration requires every migration to have a working down path.
--
-- The role is dropped last: it owns no objects, but dependent grants must go first.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM investigator_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM investigator_app;--> statement-breakpoint
REVOKE USAGE ON SCHEMA public FROM investigator_app;--> statement-breakpoint

DROP TABLE IF EXISTS "user_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "user_roles";--> statement-breakpoint
DROP TABLE IF EXISTS "audit_logs";--> statement-breakpoint
DROP TABLE IF EXISTS "users";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."user_role_name";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."account_status";--> statement-breakpoint

DROP ROLE IF EXISTS investigator_app;
