-- drizzle-kit quotes custom column types as identifiers, and a quoted parameterised
-- geography type names a type that does not exist, so the two below were unquoted by hand.
-- migrations.spec.ts fails if a quoted geography type ever reaches a migration again.
CREATE TYPE "public"."service_area_kind" AS ENUM('RADIUS', 'POLYGON');--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "service_area_kind" NOT NULL,
	"label" text NOT NULL,
	"centre" geography(Point, 4326),
	"radius_m" integer,
	"area" geography(Polygon, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_areas_area_gist" ON "service_areas" USING gist ("area");--> statement-breakpoint
CREATE INDEX "service_areas_profile_idx" ON "service_areas" USING btree ("profile_id");--> statement-breakpoint

-- The shape rules. Enforced here so they hold for every writer, not only the service.

-- A radius area has a centre and a radius and nothing else; a drawn area has neither.
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_kind_fields"
  CHECK (("kind" = 'RADIUS' AND "centre" IS NOT NULL AND "radius_m" IS NOT NULL)
      OR ("kind" = 'POLYGON' AND "centre" IS NULL AND "radius_m" IS NULL));--> statement-breakpoint

ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_radius_range"
  CHECK ("radius_m" IS NULL OR "radius_m" BETWEEN 5000 AND 300000);--> statement-breakpoint

-- Privacy. A centre is never stored more precisely than two decimal places — about a
-- kilometre — so a radius area cannot be centred on a front door.
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_centre_coarsened"
  CHECK ("centre" IS NULL OR (
    ST_X("centre"::geometry)::numeric = round(ST_X("centre"::geometry)::numeric, 2)
    AND ST_Y("centre"::geometry)::numeric = round(ST_Y("centre"::geometry)::numeric, 2)));--> statement-breakpoint

-- Privacy. No area smaller than a 5 km circle, so a tiny drawn square cannot pinpoint a house
-- either. PostGIS buffers geography through a local projection, so a 5 km buffer's area varies
-- with latitude: measured 77,948,988 m² at the equator to 78,097,887 m² at 70°. The threshold
-- sits below the smallest of those, so no genuine minimum radius is refused anywhere. (It was
-- first 78,000,000, calibrated from one point at 40°, which refused 5 km areas near the equator.)
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_min_area"
  CHECK (ST_Area("area") >= 77500000);--> statement-breakpoint

ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_area_valid"
  CHECK (ST_IsValid("area"::geometry));--> statement-breakpoint

-- One boundary, no holes, and a bounded vertex count so a single row cannot be made
-- arbitrarily expensive to test against.
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_area_simple"
  CHECK (ST_NumInteriorRings("area"::geometry) = 0 AND ST_NPoints("area"::geometry) <= 201);--> statement-breakpoint

ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_label_length"
  CHECK (length("label") BETWEEN 1 AND 80);--> statement-breakpoint

-- Stated explicitly rather than inherited from the default privileges set in 0000. An area
-- is the investigator's to remove; nothing here is evidence or history.
GRANT SELECT, INSERT, UPDATE, DELETE ON service_areas TO investigator_app;
