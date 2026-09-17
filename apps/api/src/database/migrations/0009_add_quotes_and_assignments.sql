CREATE TYPE "public"."assignment_actor_kind" AS ENUM('CUSTOMER', 'INVESTIGATOR', 'STAFF', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS', 'REPORT_SUBMITTED', 'COMPLETED', 'CANCELLED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('SUBMITTED', 'WITHDRAWN', 'ACCEPTED', 'CLOSED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "assignment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"from_status" "assignment_status",
	"to_status" "assignment_status" NOT NULL,
	"actor_kind" "assignment_actor_kind" NOT NULL,
	"actor_id" uuid,
	"staff_scope" text,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"investigator_profile_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'PENDING_ACCEPTANCE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"accepted_scope" text NOT NULL,
	"deliverables" text NOT NULL,
	"assumptions" text,
	"exclusions" text,
	"cancellation_terms" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"estimated_duration_days" smallint NOT NULL,
	"due_at" timestamp with time zone,
	"payment_reference" text NOT NULL,
	"payment_authorized_at" timestamp with time zone NOT NULL,
	"acceptance_due_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"investigator_profile_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'SUBMITTED' NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"estimated_duration_days" smallint NOT NULL,
	"scope" text NOT NULL,
	"deliverables" text NOT NULL,
	"assumptions" text,
	"exclusions" text,
	"cancellation_terms" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_status_history" ADD CONSTRAINT "assignment_status_history_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_investigator_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("investigator_profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_investigator_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("investigator_profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_status_history_assignment_idx" ON "assignment_status_history" USING btree ("assignment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_mission_unique" ON "assignments" USING btree ("mission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_quote_unique" ON "assignments" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "assignments_investigator_idx" ON "assignments" USING btree ("investigator_profile_id","status");--> statement-breakpoint
CREATE INDEX "assignments_customer_idx" ON "assignments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_unique" ON "idempotency_keys" USING btree ("actor_id","endpoint","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quotes_mission_idx" ON "quotes" USING btree ("mission_id","created_at");--> statement-breakpoint
CREATE INDEX "quotes_investigator_idx" ON "quotes" USING btree ("investigator_profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_one_live_per_investigator" ON "quotes" USING btree ("mission_id","investigator_profile_id") WHERE "quotes"."status" = 'SUBMITTED';--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_one_accepted_per_mission" ON "quotes" USING btree ("mission_id") WHERE "quotes"."status" = 'ACCEPTED';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Hand-written below this line. drizzle-kit generates no CHECK constraints and
-- no grants.
--
-- A GRANT alone decides nothing: migration 0000 sets ALTER DEFAULT PRIVILEGES
-- granting SELECT, INSERT, UPDATE and DELETE on every table created in this
-- schema, so a new table arrives fully writable. Withholding a privilege means
-- REVOKING it — 0007 shipped without the REVOKEs and its append-only tables
-- were rewritable until a test caught it.
-- ---------------------------------------------------------------------------

-- Money is an integer in minor units, and a negative price is not a discount.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_non_negative" CHECK ("price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_price_non_negative" CHECK ("price_minor" >= 0);--> statement-breakpoint

-- ISO 4217, upper case, matching missions and investigator_profiles. An amount without a
-- currency everyone spells the same way is not an amount.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');--> statement-breakpoint

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_duration_sane" CHECK (
  "estimated_duration_days" BETWEEN 1 AND 365
);--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_duration_sane" CHECK (
  "estimated_duration_days" BETWEEN 1 AND 365
);--> statement-breakpoint

-- An expiry that is not after the offer was made cannot be accepted by anyone, ever.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_expiry_after_creation" CHECK ("expires_at" > "created_at");--> statement-breakpoint

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_text_lengths" CHECK (
  length("scope") BETWEEN 1 AND 5000
  AND length("deliverables") BETWEEN 1 AND 2000
  AND length("cancellation_terms") BETWEEN 1 AND 2000
  AND ("assumptions" IS NULL OR length("assumptions") BETWEEN 1 AND 2000)
  AND ("exclusions" IS NULL OR length("exclusions") BETWEEN 1 AND 2000)
);--> statement-breakpoint

-- The timestamps that record what happened must agree with the status that claims it.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_at_consistent" CHECK (
  ("status" = 'ACCEPTED') = ("accepted_at" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_withdrawn_at_consistent" CHECK (
  ("status" = 'WITHDRAWN') = ("withdrawn_at" IS NOT NULL)
);--> statement-breakpoint

-- An assignment exists because a payment was authorized. Not "should have been" — was.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_payment_reference_present" CHECK (
  length("payment_reference") BETWEEN 1 AND 200
);--> statement-breakpoint

-- Accepting is what commits the investigator, so the two must not disagree. ACCEPTED is the
-- moment it is set; every later state has been through it.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_accepted_at_consistent" CHECK (
  ("status" IN ('PENDING_ACCEPTANCE', 'CANCELLED') AND "accepted_at" IS NULL)
  OR ("status" NOT IN ('PENDING_ACCEPTANCE') AND "accepted_at" IS NOT NULL)
  OR ("status" = 'CANCELLED')
);--> statement-breakpoint

ALTER TABLE "assignments" ADD CONSTRAINT "assignments_version_positive" CHECK ("version" >= 1);--> statement-breakpoint

-- Creation is the only history row with no previous status; every other row is a real move.
ALTER TABLE "assignment_status_history" ADD CONSTRAINT "assignment_status_history_real_move" CHECK (
  "from_status" IS NULL OR "from_status" <> "to_status"
);--> statement-breakpoint

-- A staff move records the scope it was made under; nothing else carries one.
ALTER TABLE "assignment_status_history" ADD CONSTRAINT "assignment_status_history_scope_for_staff" CHECK (
  ("actor_kind" = 'STAFF' AND "staff_scope" IS NOT NULL AND "actor_id" IS NOT NULL)
  OR ("actor_kind" = 'SYSTEM' AND "staff_scope" IS NULL AND "actor_id" IS NULL)
  OR ("actor_kind" IN ('CUSTOMER', 'INVESTIGATOR') AND "staff_scope" IS NULL AND "actor_id" IS NOT NULL)
);--> statement-breakpoint

-- quotes and assignments: no DELETE. They are the record of what was offered and agreed, and
-- both outlive the work — removing one is the retention workflow's job, not an endpoint's.
GRANT SELECT, INSERT, UPDATE ON quotes TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON quotes FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON assignments TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON assignments FROM investigator_app;--> statement-breakpoint

-- Append-only, like mission_status_history: a history that can be edited settles no dispute.
GRANT SELECT, INSERT ON assignment_status_history TO investigator_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON assignment_status_history FROM investigator_app;--> statement-breakpoint

-- Idempotency keys are updated once, when the work they guard completes. No DELETE: expiring
-- them is a retention job, and an endpoint deleting a key could let a replay execute twice.
GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON idempotency_keys FROM investigator_app;