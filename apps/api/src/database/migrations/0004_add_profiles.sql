CREATE TYPE "public"."language_proficiency" AS ENUM('BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('HOURLY', 'FIXED_FEE', 'RETAINER', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."profile_visibility" AS ENUM('DRAFT', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_node_status" AS ENUM('ACTIVE', 'DEPRECATED');--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organisation_name" text,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigator_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigator_languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"language_code" text NOT NULL,
	"proficiency" "language_proficiency" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigator_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"headline" text,
	"bio" text,
	"years_experience" smallint,
	"pricing_model" "pricing_model",
	"hourly_rate_minor" integer,
	"currency" text,
	"accepting_work" boolean DEFAULT false NOT NULL,
	"visibility" "profile_visibility" DEFAULT 'DRAFT' NOT NULL,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigator_specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"taxonomy_node_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxonomy_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"status" "taxonomy_node_status" DEFAULT 'ACTIVE' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_availability" ADD CONSTRAINT "investigator_availability_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_languages" ADD CONSTRAINT "investigator_languages_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_profiles" ADD CONSTRAINT "investigator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_specialties" ADD CONSTRAINT "investigator_specialties_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_specialties" ADD CONSTRAINT "investigator_specialties_taxonomy_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("taxonomy_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_parent_id_taxonomy_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_user_unique" ON "customer_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investigator_availability_profile_idx" ON "investigator_availability" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investigator_languages_unique" ON "investigator_languages" USING btree ("profile_id","language_code");--> statement-breakpoint
CREATE INDEX "investigator_languages_code_idx" ON "investigator_languages" USING btree ("language_code");--> statement-breakpoint
CREATE UNIQUE INDEX "investigator_profiles_user_unique" ON "investigator_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investigator_profiles_visibility_idx" ON "investigator_profiles" USING btree ("visibility","accepting_work");--> statement-breakpoint
CREATE UNIQUE INDEX "investigator_specialties_unique" ON "investigator_specialties" USING btree ("profile_id","taxonomy_node_id");--> statement-breakpoint
CREATE INDEX "investigator_specialties_node_idx" ON "investigator_specialties" USING btree ("taxonomy_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_nodes_slug_unique" ON "taxonomy_nodes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "taxonomy_nodes_parent_idx" ON "taxonomy_nodes" USING btree ("parent_id");--> statement-breakpoint

-- Integrity the application must not be the only thing enforcing. A bad row written by a
-- job, a migration or a future code path is still a bad row.

-- A window that ends before it starts is not a window, and a day outside 0-6 is not a day.
ALTER TABLE "investigator_availability"
  ADD CONSTRAINT "investigator_availability_day_range"
  CHECK ("day_of_week" BETWEEN 0 AND 6);--> statement-breakpoint
ALTER TABLE "investigator_availability"
  ADD CONSTRAINT "investigator_availability_minute_range"
  CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute");--> statement-breakpoint

-- An amount without a currency is not an amount: 5000 could be anything. Either both are
-- present or neither is.
ALTER TABLE "investigator_profiles"
  ADD CONSTRAINT "investigator_profiles_rate_needs_currency"
  CHECK (("hourly_rate_minor" IS NULL) = ("currency" IS NULL));--> statement-breakpoint
ALTER TABLE "investigator_profiles"
  ADD CONSTRAINT "investigator_profiles_rate_non_negative"
  CHECK ("hourly_rate_minor" IS NULL OR "hourly_rate_minor" >= 0);--> statement-breakpoint
ALTER TABLE "investigator_profiles"
  ADD CONSTRAINT "investigator_profiles_currency_iso4217"
  CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "investigator_profiles"
  ADD CONSTRAINT "investigator_profiles_experience_sane"
  CHECK ("years_experience" IS NULL OR ("years_experience" >= 0 AND "years_experience" <= 80));--> statement-breakpoint

-- ISO 639-1, lower case. Stored shape is checked here so a join on it cannot miss because
-- one row said 'EN' and another 'en'.
ALTER TABLE "investigator_languages"
  ADD CONSTRAINT "investigator_languages_code_iso639"
  CHECK ("language_code" ~ '^[a-z]{2}$');--> statement-breakpoint

-- A node cannot be its own parent. Deeper cycles are the service's concern; this closes the
-- one case a constraint can.
ALTER TABLE "taxonomy_nodes"
  ADD CONSTRAINT "taxonomy_nodes_no_self_parent"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");--> statement-breakpoint

-- Stated explicitly rather than inherited from the default privileges set in 0000.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  customer_profiles, investigator_profiles, investigator_languages,
  investigator_specialties, investigator_availability
  TO investigator_app;--> statement-breakpoint

-- Taxonomy is staff-maintained through the admin console (ADR-0007 rule 3). The application
-- role reads it; it does not get to invent nodes.
--
-- The REVOKE is the part that does the work. Migration 0000 set ALTER DEFAULT PRIVILEGES
-- granting SELECT, INSERT, UPDATE and DELETE on every future table, so a bare GRANT SELECT
-- here adds nothing that was not already there -- verified by inserting a node as
-- investigator_app and watching it succeed. Any table meant to be narrower than the default
-- has to say so explicitly, exactly as audit_logs does in 0000.
GRANT SELECT ON taxonomy_nodes TO investigator_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON taxonomy_nodes FROM investigator_app;
