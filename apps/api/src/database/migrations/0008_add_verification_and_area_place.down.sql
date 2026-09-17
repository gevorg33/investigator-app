-- Reverse of 0008. db-migration requires every migration to have a working down path.
ALTER TABLE "investigator_profiles" DROP CONSTRAINT IF EXISTS "investigator_profiles_verified_at_consistent";--> statement-breakpoint
ALTER TABLE "service_areas" DROP CONSTRAINT IF EXISTS "service_areas_place_lengths";--> statement-breakpoint
ALTER TABLE "service_areas" DROP CONSTRAINT IF EXISTS "service_areas_country_format";--> statement-breakpoint

DROP INDEX IF EXISTS "service_areas_country_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "investigator_profiles_visibility_idx";--> statement-breakpoint

ALTER TABLE "service_areas" DROP COLUMN IF EXISTS "city";--> statement-breakpoint
ALTER TABLE "service_areas" DROP COLUMN IF EXISTS "region";--> statement-breakpoint
ALTER TABLE "service_areas" DROP COLUMN IF EXISTS "country_code";--> statement-breakpoint

ALTER TABLE "investigator_profiles" DROP COLUMN IF EXISTS "verified_at";--> statement-breakpoint
ALTER TABLE "investigator_profiles" DROP COLUMN IF EXISTS "verification_status";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."verification_status";--> statement-breakpoint

-- Put back the index as 0004 created it, or a rollback leaves discovery's predecessor without
-- the index it was written against.
CREATE INDEX "investigator_profiles_visibility_idx" ON "investigator_profiles" USING btree ("visibility","accepting_work");
