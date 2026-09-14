-- Reverse of 0006. db-migration requires every migration to have a working down path.
REVOKE ALL ON service_areas FROM investigator_app;--> statement-breakpoint
DROP TABLE IF EXISTS "service_areas";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."service_area_kind";
