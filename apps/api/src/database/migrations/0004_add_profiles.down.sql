-- Reverse of 0004. db-migration requires every migration to have a working down path.
REVOKE ALL ON
  customer_profiles, investigator_profiles, investigator_languages,
  investigator_specialties, investigator_availability, taxonomy_nodes
  FROM investigator_app;--> statement-breakpoint

-- Children before parents: each references the row above it.
DROP TABLE IF EXISTS "investigator_availability";--> statement-breakpoint
DROP TABLE IF EXISTS "investigator_languages";--> statement-breakpoint
DROP TABLE IF EXISTS "investigator_specialties";--> statement-breakpoint
DROP TABLE IF EXISTS "investigator_profiles";--> statement-breakpoint
DROP TABLE IF EXISTS "customer_profiles";--> statement-breakpoint
DROP TABLE IF EXISTS "taxonomy_nodes";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."language_proficiency";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."profile_visibility";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."pricing_model";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."taxonomy_node_status";
