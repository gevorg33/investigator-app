CREATE TYPE "public"."mission_actor_kind" AS ENUM('CUSTOMER', 'INVESTIGATOR', 'STAFF', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."mission_screening_outcome" AS ENUM('ROUTINE_REVIEW', 'PRIORITY_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."mission_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'CUSTOMER_CONFIRMED', 'PAID', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REPORT_SUBMITTED', 'CUSTOMER_REVIEW', 'COMPLETED', 'CANCELLED', 'REJECTED', 'DISPUTED', 'SUSPENDED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."subject_relationship" AS ENUM('SELF_OR_OWN_ORGANISATION', 'EMPLOYER', 'BUSINESS_RELATIONSHIP', 'LEGAL_REPRESENTATIVE', 'FAMILY_MEMBER', 'PARTNER_OR_SPOUSE', 'FORMER_PARTNER', 'NO_PERSONAL_RELATIONSHIP', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."risk_band" AS ENUM('STANDARD', 'ELEVATED', 'HIGH', 'RESTRICTED');--> statement-breakpoint
CREATE TABLE "mission_screenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"mission_version" integer NOT NULL,
	"ruleset_version" text NOT NULL,
	"outcome" "mission_screening_outcome" NOT NULL,
	"risk_band" "risk_band" NOT NULL,
	"flags" jsonb NOT NULL,
	"ai_classification" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"from_status" "mission_status",
	"to_status" "mission_status" NOT NULL,
	"actor_kind" "mission_actor_kind" NOT NULL,
	"actor_id" uuid,
	"staff_scope" text,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "mission_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"taxonomy_node_id" uuid,
	"title" text,
	"description" text,
	"country_code" text,
	"location_label" text,
	"location" geography(Point, 4326),
	"start_by" date,
	"deadline" date,
	"budget_min_minor" integer,
	"budget_max_minor" integer,
	"currency" text,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"purpose" text,
	"subject_relationship" "subject_relationship",
	"protective_order_declared" boolean,
	"lawful_purpose_confirmed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD COLUMN "risk_band" "risk_band";--> statement-breakpoint
ALTER TABLE "mission_screenings" ADD CONSTRAINT "mission_screenings_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_status_history" ADD CONSTRAINT "mission_status_history_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_taxonomy_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("taxonomy_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_screenings_mission_idx" ON "mission_screenings" USING btree ("mission_id","created_at");--> statement-breakpoint
CREATE INDEX "mission_status_history_mission_idx" ON "mission_status_history" USING btree ("mission_id","occurred_at");--> statement-breakpoint
CREATE INDEX "missions_customer_idx" ON "missions" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "missions_status_idx" ON "missions" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "missions_taxonomy_node_idx" ON "missions" USING btree ("taxonomy_node_id");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("occurred_at") WHERE "outbox_events"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Hand-written below this line. drizzle-kit generates no CHECK constraints and
-- no grants; both are part of the schema, not decoration.
-- ---------------------------------------------------------------------------

-- The lawful-purpose rule, in the database rather than only in the service: a mission that
-- has left DRAFT carries the customer's confirmation and everything review depends on. Any
-- writer that tries otherwise fails, not just the one endpoint anybody remembered to check.
--
-- CANCELLED is excluded because a draft can be abandoned without ever being completed.
ALTER TABLE "missions" ADD CONSTRAINT "missions_submission_complete" CHECK (
  "status" IN ('DRAFT', 'CANCELLED') OR (
    "lawful_purpose_confirmed_at" IS NOT NULL
    AND "submitted_at" IS NOT NULL
    AND "taxonomy_node_id" IS NOT NULL
    AND "title" IS NOT NULL
    AND "description" IS NOT NULL
    AND "country_code" IS NOT NULL
    AND "deadline" IS NOT NULL
    AND "budget_min_minor" IS NOT NULL
    AND "budget_max_minor" IS NOT NULL
    AND "currency" IS NOT NULL
    AND cardinality("languages") >= 1
    AND "purpose" IS NOT NULL
    AND "subject_relationship" IS NOT NULL
  )
);--> statement-breakpoint

-- The protective-order question is asked where the relationship is personal, and answered
-- before submission (docs/knowledge-base/policies/prohibited-requests.en.md).
ALTER TABLE "missions" ADD CONSTRAINT "missions_protective_order_answered" CHECK (
  "status" IN ('DRAFT', 'CANCELLED')
  OR "subject_relationship" NOT IN ('FAMILY_MEMBER', 'PARTNER_OR_SPOUSE', 'FORMER_PARTNER')
  OR "protective_order_declared" IS NOT NULL
);--> statement-breakpoint

ALTER TABLE "missions" ADD CONSTRAINT "missions_budget_range" CHECK (
  ("budget_min_minor" IS NULL OR "budget_min_minor" >= 0)
  AND ("budget_max_minor" IS NULL OR "budget_max_minor" >= 0)
  AND ("budget_min_minor" IS NULL OR "budget_max_minor" IS NULL OR "budget_min_minor" <= "budget_max_minor")
);--> statement-breakpoint

ALTER TABLE "missions" ADD CONSTRAINT "missions_currency_format" CHECK (
  "currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'
);--> statement-breakpoint

ALTER TABLE "missions" ADD CONSTRAINT "missions_country_format" CHECK (
  "country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$'
);--> statement-breakpoint

-- ISO 639-1, lower case, matching investigator_languages. Bounded so one row cannot carry
-- an arbitrary number of filter values.
-- Joined and matched as one string because a CHECK constraint may not contain a subquery,
-- which rules out unnesting the array to test each element.
ALTER TABLE "missions" ADD CONSTRAINT "missions_languages_valid" CHECK (
  cardinality("languages") <= 10
  AND (cardinality("languages") = 0 OR array_to_string("languages", ',') ~ '^[a-z]{2}(,[a-z]{2})*$')
);--> statement-breakpoint

ALTER TABLE "missions" ADD CONSTRAINT "missions_timeline_order" CHECK (
  "start_by" IS NULL OR "deadline" IS NULL OR "start_by" <= "deadline"
);--> statement-breakpoint

ALTER TABLE "missions" ADD CONSTRAINT "missions_text_lengths" CHECK (
  ("title" IS NULL OR length("title") BETWEEN 1 AND 120)
  AND ("description" IS NULL OR length("description") BETWEEN 1 AND 5000)
  AND ("purpose" IS NULL OR length("purpose") BETWEEN 1 AND 2000)
  AND ("location_label" IS NULL OR length("location_label") BETWEEN 1 AND 120)
);--> statement-breakpoint

-- A mission's location is often where its subject lives. Stored no more precisely than about
-- a kilometre, exactly as a service-area centre is (migration 0006).
ALTER TABLE "missions" ADD CONSTRAINT "missions_location_coarsened" CHECK (
  "location" IS NULL OR (
    ST_X("location"::geometry) = round(ST_X("location"::geometry)::numeric, 2)::double precision
    AND ST_Y("location"::geometry) = round(ST_Y("location"::geometry)::numeric, 2)::double precision
  )
);--> statement-breakpoint

ALTER TABLE "missions" ADD CONSTRAINT "missions_version_positive" CHECK ("version" >= 1);--> statement-breakpoint

-- Creation is the only row with no previous status; every other row is a real move.
ALTER TABLE "mission_status_history" ADD CONSTRAINT "mission_status_history_real_move" CHECK (
  "from_status" IS NULL OR "from_status" <> "to_status"
);--> statement-breakpoint

-- A staff move records the scope it was made under; nothing else carries one.
ALTER TABLE "mission_status_history" ADD CONSTRAINT "mission_status_history_scope_for_staff" CHECK (
  ("actor_kind" = 'STAFF' AND "staff_scope" IS NOT NULL AND "actor_id" IS NOT NULL)
  OR ("actor_kind" = 'SYSTEM' AND "staff_scope" IS NULL AND "actor_id" IS NULL)
  OR ("actor_kind" IN ('CUSTOMER', 'INVESTIGATOR') AND "staff_scope" IS NULL AND "actor_id" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "mission_screenings" ADD CONSTRAINT "mission_screenings_flags_array" CHECK (
  jsonb_typeof("flags") = 'array'
);--> statement-breakpoint

-- GRANT alone decides nothing here. Migration 0000 sets ALTER DEFAULT PRIVILEGES granting
-- SELECT, INSERT, UPDATE and DELETE on every table created in this schema, so a new table
-- arrives fully writable and a narrower GRANT adds nothing to it. Withholding a privilege
-- means REVOKING it, exactly as 0000 does for audit_logs — verified by grants.spec.ts, which
-- failed against these tables before these REVOKEs existed.

-- missions: no DELETE. A mission carries history, and later quotes and money; removing one is
-- the retention workflow's job, not an endpoint's.
GRANT SELECT, INSERT, UPDATE ON missions TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON missions FROM investigator_app;--> statement-breakpoint

-- Append-only, like audit_logs: a status history that can be edited settles no dispute, and a
-- screening result that can be rewritten explains nothing.
GRANT SELECT, INSERT ON mission_status_history TO investigator_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON mission_status_history FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT ON mission_screenings TO investigator_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON mission_screenings FROM investigator_app;--> statement-breakpoint

-- The relay marks rows published and counts attempts, so UPDATE is needed here. No DELETE:
-- pruning delivered events is a retention job.
GRANT SELECT, INSERT, UPDATE ON outbox_events TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON outbox_events FROM investigator_app;