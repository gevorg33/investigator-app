-- T-031: where information in an assignment came from (plan.md §8). Approved 2026-09-23: the
-- asymmetric policy below, resource authorization on assignment participation, and withdrawal in
-- place of deletion.

CREATE TYPE "public"."investigation_source_type" AS ENUM('PUBLIC_RECORD', 'REGISTRY', 'WEBSITE', 'WITNESS', 'DOCUMENT', 'OBSERVATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."source_reliability" AS ENUM('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "investigation_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"type" "investigation_source_type" NOT NULL,
	"title" text NOT NULL,
	"locator" text,
	"accessed_at" timestamp with time zone,
	"reliability" "source_reliability" DEFAULT 'UNKNOWN' NOT NULL,
	"reliability_rationale" text,
	"shared" boolean DEFAULT false NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"supplier_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investigation_sources" ADD CONSTRAINT "investigation_sources_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_sources" ADD CONSTRAINT "investigation_sources_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_sources" ADD CONSTRAINT "investigation_sources_parties_fk" FOREIGN KEY ("assignment_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."assignments"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigation_sources_assignment_idx" ON "investigation_sources" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "investigation_sources_supplier_tenant_idx" ON "investigation_sources" USING btree ("supplier_tenant_id");--> statement-breakpoint
CREATE INDEX "investigation_sources_customer_tenant_idx" ON "investigation_sources" USING btree ("customer_tenant_id");--> statement-breakpoint

ALTER TABLE "investigation_sources"
  ADD CONSTRAINT "investigation_sources_title_length" CHECK (length(btrim("title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "investigation_sources_locator_length" CHECK ("locator" IS NULL OR length("locator") <= 2000),
  -- A reliability judgement without its reason is an assertion; UNKNOWN is the honest default.
  ADD CONSTRAINT "investigation_sources_rationale_when_judged" CHECK (
    "reliability" = 'UNKNOWN'
    OR ("reliability_rationale" IS NOT NULL AND length(btrim("reliability_rationale")) BETWEEN 1 AND 1000)
  );--> statement-breakpoint

-- The two workspaces come from the assignment and never change (T-076), as for every two-party row.
CREATE TRIGGER investigation_sources_fill_from_assignment BEFORE INSERT ON investigation_sources
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('assignments', 'assignment_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER investigation_sources_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON investigation_sources
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint

-- A source stays with the assignment and the person who recorded it, and a withdrawal is final:
-- evidence may already cite it (T-116), and "withdrawn, then quietly restored" is not a history
-- anyone can reason about afterwards.
CREATE FUNCTION keep_investigation_source_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.added_by IS DISTINCT FROM OLD.added_by THEN
    RAISE EXCEPTION 'a source stays with its assignment and the person who recorded it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
    RAISE EXCEPTION 'a withdrawn source stays withdrawn'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER investigation_sources_record_kept BEFORE UPDATE ON investigation_sources
  FOR EACH ROW EXECUTE FUNCTION keep_investigation_source_record();--> statement-breakpoint

-- The REVOKE does the work: migration 0000's default privileges would otherwise include DELETE.
REVOKE ALL ON investigation_sources FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON investigation_sources TO investigator_app;--> statement-breakpoint

-- Asymmetric, unlike the other two-party tables: the investigator's workspace reads and writes;
-- the customer's reads only what has been shared and not withdrawn. A source can name a third
-- party, and the customer learns who only if the investigator decides (owner decision).
ALTER TABLE investigation_sources ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigation_sources FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_works ON investigation_sources FOR ALL
  USING (supplier_tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (supplier_tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY customer_reads_shared ON investigation_sources FOR SELECT
  USING (customer_tenant_id = app_current_tenant() AND shared AND withdrawn_at IS NULL);
