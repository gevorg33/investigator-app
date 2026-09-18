CREATE TYPE "public"."verification_outcome" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."verification_request_status" AS ENUM('SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "verification_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"outcome" "verification_outcome" NOT NULL,
	"reason" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_request_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"status" "verification_request_status" DEFAULT 'SUBMITTED' NOT NULL,
	"declared_scope" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_decisions" ADD CONSTRAINT "verification_decisions_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."verification_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_request_documents" ADD CONSTRAINT "verification_request_documents_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."verification_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_request_documents" ADD CONSTRAINT "verification_request_documents_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_decisions_one_per_request" ON "verification_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_request_documents_unique" ON "verification_request_documents" USING btree ("request_id","media_asset_id");--> statement-breakpoint
CREATE INDEX "verification_request_documents_asset_idx" ON "verification_request_documents" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "verification_requests_queue_idx" ON "verification_requests" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "verification_requests_profile_idx" ON "verification_requests" USING btree ("profile_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_requests_one_open_per_profile" ON "verification_requests" USING btree ("profile_id") WHERE "verification_requests"."status" = 'SUBMITTED';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Hand-written below this line. drizzle-kit generates no CHECK constraints and
-- no grants. Migration 0000's ALTER DEFAULT PRIVILEGES makes every new table
-- fully writable, so withholding a privilege means REVOKING it.
-- ---------------------------------------------------------------------------

-- A request is decided exactly when it carries a decision time. An APPROVED request without
-- one, or an open one with one, is a status nobody can explain.
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_decided_at_consistent" CHECK (
  ("status" = 'SUBMITTED') = ("decided_at" IS NULL)
);--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_decided_after_submitted" CHECK (
  "decided_at" IS NULL OR "decided_at" >= "submitted_at"
);--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_version_positive" CHECK ("version" >= 1);--> statement-breakpoint

-- The snapshot is an object with both lists, never a bare value a reviewer cannot read.
-- IS NOT DISTINCT FROM rather than =: a missing key makes jsonb_typeof NULL, and a CHECK that
-- evaluates to NULL passes — so with = a declaration missing a list would be accepted.
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_declared_scope_shape" CHECK (
  jsonb_typeof("declared_scope") IS NOT DISTINCT FROM 'object'
  AND jsonb_typeof("declared_scope" -> 'specialtyNodeIds') IS NOT DISTINCT FROM 'array'
  AND jsonb_typeof("declared_scope" -> 'serviceAreas') IS NOT DISTINCT FROM 'array'
);--> statement-breakpoint

-- A reason the applicant can act on: present, not blank, and not a document in itself.
ALTER TABLE "verification_decisions" ADD CONSTRAINT "verification_decisions_reason_present" CHECK (
  length("reason") BETWEEN 1 AND 2000 AND "reason" ~ '\S'
);--> statement-breakpoint

-- Requests: no DELETE. An application is the record of how someone came to be verified.
GRANT SELECT, INSERT, UPDATE ON verification_requests TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON verification_requests FROM investigator_app;--> statement-breakpoint

-- The documents a request was made with are fixed at submission, and a decision is attributed
-- permanently. Both append-only: an edited decision settles no later dispute.
GRANT SELECT, INSERT ON verification_request_documents TO investigator_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON verification_request_documents FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT ON verification_decisions TO investigator_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON verification_decisions FROM investigator_app;
