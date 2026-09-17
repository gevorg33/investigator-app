CREATE TYPE "public"."verification_status" AS ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
DROP INDEX "investigator_profiles_visibility_idx";--> statement-breakpoint
ALTER TABLE "investigator_profiles" ADD COLUMN "verification_status" "verification_status" DEFAULT 'UNVERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "investigator_profiles" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "city" text;--> statement-breakpoint
CREATE INDEX "service_areas_country_idx" ON "service_areas" USING btree ("country_code","city");--> statement-breakpoint
CREATE INDEX "investigator_profiles_visibility_idx" ON "investigator_profiles" USING btree ("visibility","verification_status","accepting_work");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Hand-written below this line. drizzle-kit generates no CHECK constraints.
-- No GRANTs here: these are columns on existing tables, which carry the table's
-- privileges. A new TABLE would need both a GRANT and a REVOKE (see 0007).
-- ---------------------------------------------------------------------------

-- ISO 3166-1 alpha-2, upper case, matching missions.country_code. A country filter is only a
-- filter if both sides agree on the spelling.
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_country_format" CHECK (
  "country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$'
);--> statement-breakpoint

ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_place_lengths" CHECK (
  ("region" IS NULL OR length("region") BETWEEN 1 AND 80)
  AND ("city" IS NULL OR length("city") BETWEEN 1 AND 80)
);--> statement-breakpoint

-- A verification date and a verified status are the same fact, so neither may exist without
-- the other: a VERIFIED profile that cannot say when it was verified is not reviewable, and a
-- timestamp on an unverified profile is a claim nobody made. Equality in both directions, so
-- T-013 must set the date when it grants the status.
ALTER TABLE "investigator_profiles" ADD CONSTRAINT "investigator_profiles_verified_at_consistent" CHECK (
  ("verification_status" = 'VERIFIED') = ("verified_at" IS NOT NULL)
);