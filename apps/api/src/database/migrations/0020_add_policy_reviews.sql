-- T-050: an investigator's lawful-grounds refusal, staff's review of it, and the money decision that
-- follows — recorded separately. Approved 2026-09-23: a staff decision route under MODERATION,
-- money decisions recorded for payments to execute later (T-110 to T-113), the enforcement edge.

CREATE TYPE "public"."money_decision_kind" AS ENUM('FULL_REFUND', 'HOLD', 'RESUME', 'SPLIT');--> statement-breakpoint
CREATE TYPE "public"."policy_review_disposition" AS ENUM('RESUME', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."policy_review_finding" AS ENUM('SUBSTANTIATED', 'UNSUBSTANTIATED');--> statement-breakpoint
CREATE TYPE "public"."policy_review_kind" AS ENUM('DECLINE', 'HALT');--> statement-breakpoint
CREATE TABLE "money_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"policy_review_id" uuid,
	"decision" "money_decision_kind" NOT NULL,
	"investigator_amount_minor" integer,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"supplier_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"kind" "policy_review_kind" NOT NULL,
	"ground" text NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finding" "policy_review_finding",
	"bad_faith" boolean DEFAULT false NOT NULL,
	"disposition" "policy_review_disposition",
	"reasoning" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"supplier_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "money_decisions" ADD CONSTRAINT "money_decisions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_decisions" ADD CONSTRAINT "money_decisions_policy_review_id_policy_reviews_id_fk" FOREIGN KEY ("policy_review_id") REFERENCES "public"."policy_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_decisions" ADD CONSTRAINT "money_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_decisions" ADD CONSTRAINT "money_decisions_parties_fk" FOREIGN KEY ("assignment_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."assignments"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_reviews" ADD CONSTRAINT "policy_reviews_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_reviews" ADD CONSTRAINT "policy_reviews_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_reviews" ADD CONSTRAINT "policy_reviews_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_reviews" ADD CONSTRAINT "policy_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_reviews" ADD CONSTRAINT "policy_reviews_parties_fk" FOREIGN KEY ("assignment_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."assignments"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_decisions_assignment_idx" ON "money_decisions" USING btree ("assignment_id","decided_at");--> statement-breakpoint
CREATE INDEX "money_decisions_customer_tenant_idx" ON "money_decisions" USING btree ("customer_tenant_id");--> statement-breakpoint
CREATE INDEX "money_decisions_supplier_tenant_idx" ON "money_decisions" USING btree ("supplier_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_reviews_one_open" ON "policy_reviews" USING btree ("assignment_id") WHERE "policy_reviews"."decided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "policy_reviews_open_queue_idx" ON "policy_reviews" USING btree ("raised_at") WHERE "policy_reviews"."decided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "policy_reviews_raised_by_idx" ON "policy_reviews" USING btree ("raised_by");--> statement-breakpoint
CREATE INDEX "policy_reviews_supplier_tenant_idx" ON "policy_reviews" USING btree ("supplier_tenant_id");--> statement-breakpoint

-- ── policy_reviews ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE "policy_reviews"
  ADD CONSTRAINT "policy_reviews_ground_length" CHECK (length(btrim("ground")) BETWEEN 20 AND 2000),
  -- Open, or decided in full: a finding with no reasoning is an assertion, and staff's decision is
  -- exactly what this table exists to record.
  ADD CONSTRAINT "policy_reviews_decided_in_full" CHECK (
    ("decided_at" IS NULL AND "finding" IS NULL AND "disposition" IS NULL AND "reasoning" IS NULL
      AND "decided_by" IS NULL AND NOT "bad_faith")
    OR ("decided_at" IS NOT NULL AND "finding" IS NOT NULL AND "decided_by" IS NOT NULL
      AND "reasoning" IS NOT NULL AND length(btrim("reasoning")) BETWEEN 20 AND 4000
      -- A halted assignment resumes or is cancelled; a declined one is already cancelled.
      AND ("kind" = 'DECLINE') = ("disposition" IS NULL))
  ),
  ADD CONSTRAINT "policy_reviews_bad_faith_is_unsubstantiated" CHECK (
    NOT "bad_faith" OR "finding" = 'UNSUBSTANTIATED'
  );--> statement-breakpoint

-- Both workspaces and the mission come from the assignment, never from the request.
CREATE TRIGGER policy_reviews_fill_from_assignment BEFORE INSERT ON policy_reviews
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('assignments', 'assignment_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id', 'mission_id:mission_id');--> statement-breakpoint
CREATE TRIGGER policy_reviews_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON policy_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint

-- What was raised is never rewritten, and a decision is made once.
CREATE FUNCTION keep_policy_review_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.assignment_id, NEW.mission_id, NEW.kind, NEW.ground, NEW.raised_by, NEW.raised_at)
     IS DISTINCT FROM (OLD.assignment_id, OLD.mission_id, OLD.kind, OLD.ground, OLD.raised_by, OLD.raised_at) THEN
    RAISE EXCEPTION 'what an investigator raised is never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.decided_at IS NOT NULL THEN
    RAISE EXCEPTION 'a policy review is decided once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER policy_reviews_record_kept BEFORE UPDATE ON policy_reviews
  FOR EACH ROW EXECUTE FUNCTION keep_policy_review_record();--> statement-breakpoint

-- ── money_decisions ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "money_decisions"
  ADD CONSTRAINT "money_decisions_split_has_amount" CHECK (
    ("decision" = 'SPLIT') = ("investigator_amount_minor" IS NOT NULL)
  ),
  ADD CONSTRAINT "money_decisions_amount_non_negative" CHECK (
    "investigator_amount_minor" IS NULL OR "investigator_amount_minor" >= 0
  ),
  ADD CONSTRAINT "money_decisions_reason_length" CHECK (length(btrim("reason")) BETWEEN 5 AND 2000);--> statement-breakpoint

-- Parties and currency come from the assignment: a decision cannot name a different currency, and
-- a split can never award the investigator more than the customer paid.
CREATE TRIGGER money_decisions_fill_from_assignment BEFORE INSERT ON money_decisions
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('assignments', 'assignment_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id', 'currency:currency');--> statement-breakpoint
CREATE TRIGGER money_decisions_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON money_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint

CREATE FUNCTION check_money_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  price integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT price_minor INTO price FROM assignments WHERE id = NEW.assignment_id;
    IF NEW.investigator_amount_minor IS NOT NULL AND NEW.investigator_amount_minor > price THEN
      RAISE EXCEPTION 'a split cannot pay the investigator more than the customer paid'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.executed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a money decision is recorded before it is executed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- An update is payments marking the decision carried out, once, and nothing else.
  IF OLD.executed_at IS NOT NULL OR NEW.executed_at IS NULL
     OR (to_jsonb(NEW) - 'executed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'executed_at') THEN
    RAISE EXCEPTION 'a money decision is never changed, only marked executed once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER money_decisions_checked BEFORE INSERT OR UPDATE ON money_decisions
  FOR EACH ROW EXECUTE FUNCTION check_money_decision();--> statement-breakpoint

-- ── grants: the REVOKEs do the work; DELETE is never granted ─────────────────────────────────────
REVOKE ALL ON policy_reviews FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON money_decisions FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON policy_reviews TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON money_decisions TO investigator_app;--> statement-breakpoint

-- ── row-level security ──────────────────────────────────────────────────────────────────────────
-- The investigator's workspace raises a review and reads it; only staff, inside PlatformContext,
-- decide one. The customer does not read it: the ground can describe the customer's own material.
ALTER TABLE policy_reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE policy_reviews FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_reads ON policy_reviews FOR SELECT
  USING (supplier_tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY supplier_raises ON policy_reviews FOR INSERT
  WITH CHECK ((supplier_tenant_id = app_current_tenant() AND decided_at IS NULL) OR app_platform_access());--> statement-breakpoint
CREATE POLICY staff_decides ON policy_reviews FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint

-- Both parties read what happens to the money. The investigator's workspace may record only the two
-- decisions its own actions entail — a refund on declining, a hold on halting — and staff record
-- the rest. Nobody outside PlatformContext marks one executed.
ALTER TABLE money_decisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE money_decisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY parties_read ON money_decisions FOR SELECT
  USING (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access());--> statement-breakpoint
CREATE POLICY supplier_records_own_consequence ON money_decisions FOR INSERT
  WITH CHECK ((supplier_tenant_id = app_current_tenant() AND decision IN ('FULL_REFUND', 'HOLD'))
              OR app_platform_access());--> statement-breakpoint
CREATE POLICY staff_executes ON money_decisions FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());
