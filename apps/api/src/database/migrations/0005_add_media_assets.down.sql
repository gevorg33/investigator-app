-- Reverse of 0005. db-migration requires every migration to have a working down path.
REVOKE ALL ON media_assets FROM investigator_app;--> statement-breakpoint
DROP TABLE IF EXISTS "media_assets";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."media_scan_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."media_upload_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."media_visibility";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."media_category";
