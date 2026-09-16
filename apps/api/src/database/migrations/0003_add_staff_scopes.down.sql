-- Reverse of 0003. db-migration requires every migration to have a working down path.
REVOKE ALL ON user_staff_scopes FROM investigator_app;--> statement-breakpoint

DROP TABLE IF EXISTS "user_staff_scopes";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."staff_scope";
