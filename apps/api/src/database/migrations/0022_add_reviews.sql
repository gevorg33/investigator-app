-- T-037: reviews. A customer rates a COMPLETED assignment once; the words of the review and the
-- investigator's one response are pre-moderated. Approved 2026-09-25 (owner): the design below —
-- row-level security with a public projection, staff moderation and removal under PlatformContext,
-- pre-moderation, a computed rating summary, discovery ordering unchanged.
--
-- Drizzle also proposed four statements on the knowledge tables. They were removed: 0021 created
-- those objects by hand, and only its snapshot was stale. This migration's snapshot records them.

CREATE TYPE "public"."review_text_kind" AS ENUM('REVIEW', 'RESPONSE');--> statement-breakpoint
CREATE TYPE "public"."review_text_status" AS ENUM('PENDING', 'PUBLISHED', 'HIDDEN');--> statement-breakpoint
CREATE TABLE "review_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"kind" "review_text_kind" NOT NULL,
	"body" text NOT NULL,
	"status" "review_text_status" DEFAULT 'PENDING' NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_reason" text,
	"reported_by" uuid,
	"reported_at" timestamp with time zone,
	"report_reason" text,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"supplier_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"investigator_profile_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removal_reason" text,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"supplier_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
-- Before the foreign keys: review_texts_parties_fk references it.
CREATE UNIQUE INDEX "reviews_id_parties_key" ON "reviews" USING btree ("id","customer_tenant_id","supplier_tenant_id");--> statement-breakpoint
ALTER TABLE "review_texts" ADD CONSTRAINT "review_texts_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_texts" ADD CONSTRAINT "review_texts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_texts" ADD CONSTRAINT "review_texts_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_texts" ADD CONSTRAINT "review_texts_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_texts" ADD CONSTRAINT "review_texts_parties_fk" FOREIGN KEY ("review_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."reviews"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_investigator_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("investigator_profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_parties_fk" FOREIGN KEY ("assignment_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."assignments"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_texts_one_per_kind" ON "review_texts" USING btree ("review_id","kind");--> statement-breakpoint
CREATE INDEX "review_texts_pending_queue_idx" ON "review_texts" USING btree ("created_at") WHERE "review_texts"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "review_texts_customer_tenant_idx" ON "review_texts" USING btree ("customer_tenant_id");--> statement-breakpoint
CREATE INDEX "review_texts_supplier_tenant_idx" ON "review_texts" USING btree ("supplier_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_per_assignment" ON "reviews" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "reviews_profile_idx" ON "reviews" USING btree ("investigator_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_customer_tenant_idx" ON "reviews" USING btree ("customer_tenant_id");--> statement-breakpoint
CREATE INDEX "reviews_supplier_tenant_idx" ON "reviews" USING btree ("supplier_tenant_id");--> statement-breakpoint

-- ── reviews ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
  -- Standing, or removed in full: a removal with no reason is an assertion.
  ADD CONSTRAINT "reviews_removed_in_full" CHECK (
    ("removed_at" IS NULL AND "removed_by" IS NULL AND "removal_reason" IS NULL)
    OR ("removed_at" IS NOT NULL AND "removed_by" IS NOT NULL
        AND length(btrim("removal_reason")) BETWEEN 20 AND 2000)
  );--> statement-breakpoint

-- Both workspaces and the investigator come from the assignment, never from the request.
CREATE TRIGGER reviews_fill_from_assignment BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('assignments', 'assignment_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id', 'investigator_profile_id:investigator_profile_id');--> statement-breakpoint
CREATE TRIGGER reviews_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint

-- Only a completed assignment is reviewed, and a review is never rewritten: staff may remove it,
-- once, with a reason, and that is the only change. COMPLETED is terminal, so the status read here
-- cannot change under the insert. The assignment is read with the writer's privileges: one the
-- writer cannot see reads as no status, and the insert is refused.
CREATE FUNCTION check_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  parent_status assignment_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status FROM assignments WHERE id = NEW.assignment_id;
    IF parent_status IS DISTINCT FROM 'COMPLETED' THEN
      RAISE EXCEPTION 'review_after_completion: an assignment is reviewed only once it is COMPLETED'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'review_after_completion';
    END IF;
    IF NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'review_removed_by_staff: a review is written standing; only staff remove one'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'review_removed_by_staff';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.removed_at IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['removed_at', 'removed_by', 'removal_reason'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['removed_at', 'removed_by', 'removal_reason']) THEN
    RAISE EXCEPTION 'review_is_kept: a review is never rewritten; staff may remove it once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_is_kept';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER reviews_checked BEFORE INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION check_review();--> statement-breakpoint

-- ── review_texts ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "review_texts"
  ADD CONSTRAINT "review_texts_body_length" CHECK (length(btrim("body")) BETWEEN 1 AND 2000),
  -- A moderation names its moderator; a text is published or hidden only by one; hiding says why.
  ADD CONSTRAINT "review_texts_moderated_in_full" CHECK (
    ("moderated_at" IS NULL) = ("moderated_by" IS NULL)
    AND ("status" = 'PENDING' OR "moderated_at" IS NOT NULL)
    AND ("status" <> 'HIDDEN' OR length(btrim(coalesce("moderation_reason", ''))) BETWEEN 10 AND 1000)
  ),
  ADD CONSTRAINT "review_texts_reported_in_full" CHECK (
    ("reported_at" IS NULL AND "reported_by" IS NULL AND "report_reason" IS NULL)
    OR ("reported_at" IS NOT NULL AND "reported_by" IS NOT NULL
        AND length(btrim("report_reason")) BETWEEN 10 AND 1000)
  );--> statement-breakpoint

CREATE TRIGGER review_texts_fill_from_review BEFORE INSERT ON review_texts
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('reviews', 'review_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER review_texts_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON review_texts
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint

-- Every text starts PENDING (pre-moderation), a removed review takes no new words, and the words are
-- never rewritten. After that there are exactly two kinds of change: staff moderating, inside
-- PlatformContext, who leave the report as it was; and the other party reporting a published text
-- back to review, who change nothing but the status and the report.
CREATE FUNCTION check_review_text() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.moderated_at IS NOT NULL OR NEW.reported_at IS NOT NULL THEN
      RAISE EXCEPTION 'review_text_starts_pending: every text waits for moderation'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'review_text_starts_pending';
    END IF;
    IF EXISTS (SELECT 1 FROM reviews WHERE id = NEW.review_id AND removed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'review_text_on_removed_review: a removed review takes no new words'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'review_text_on_removed_review';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.review_id, NEW.kind, NEW.body, NEW.author_id, NEW.created_at)
     IS DISTINCT FROM (OLD.review_id, OLD.kind, OLD.body, OLD.author_id, OLD.created_at) THEN
    RAISE EXCEPTION 'review_text_is_kept: the words of a review or response are never rewritten'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_text_is_kept';
  END IF;
  IF app_platform_access() THEN
    IF (NEW.reported_by, NEW.reported_at, NEW.report_reason)
       IS DISTINCT FROM (OLD.reported_by, OLD.reported_at, OLD.report_reason) THEN
      RAISE EXCEPTION 'review_text_moderation_only: staff moderate a text and leave its report as it was'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'review_text_moderation_only';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (OLD.status = 'PUBLISHED' AND NEW.status = 'PENDING'
          AND NEW.reported_at IS DISTINCT FROM OLD.reported_at
          AND (NEW.moderated_by, NEW.moderated_at, NEW.moderation_reason)
              IS NOT DISTINCT FROM (OLD.moderated_by, OLD.moderated_at, OLD.moderation_reason)) THEN
    RAISE EXCEPTION 'review_text_report_only: outside moderation, a text can only be reported back to review'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_text_report_only';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER review_texts_checked BEFORE INSERT OR UPDATE ON review_texts
  FOR EACH ROW EXECUTE FUNCTION check_review_text();--> statement-breakpoint

-- ── grants: the REVOKEs do the work; DELETE is never granted ─────────────────────────────────────
REVOKE ALL ON reviews FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON review_texts FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON reviews TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON review_texts TO investigator_app;--> statement-breakpoint

-- ── row-level security ──────────────────────────────────────────────────────────────────────────
-- Both parties read their review in full, and staff read it inside PlatformContext. Everyone else
-- signed in reads a rating once the investigator's profile is published and while the review
-- stands — an unpublished profile has no reviews anyone can see, so none reveals that it exists.
-- Only the customer's workspace writes one; only staff remove one.
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY parties_read ON reviews FOR SELECT
  USING (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON reviews FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND removed_at IS NULL AND EXISTS (
    SELECT 1 FROM investigator_profiles p
     WHERE p.id = reviews.investigator_profile_id AND p.visibility = 'PUBLISHED'));--> statement-breakpoint
CREATE POLICY customer_writes ON reviews FOR INSERT
  WITH CHECK (customer_tenant_id = app_current_tenant() AND removed_at IS NULL);--> statement-breakpoint
CREATE POLICY staff_removes ON reviews FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint

-- Words are read in any state by both parties and by staff; by everyone else only while PUBLISHED
-- and only when the review itself is readable to them (its policy, above, reaches no further). The
-- customer writes the review's words, the investigator's workspace the response; staff moderate;
-- the party who did not write a published text may report it back to PENDING.
ALTER TABLE review_texts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE review_texts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY parties_read ON review_texts FOR SELECT
  USING (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON review_texts FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND status = 'PUBLISHED' AND EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_texts.review_id));--> statement-breakpoint
CREATE POLICY author_writes ON review_texts FOR INSERT
  WITH CHECK ((kind = 'REVIEW' AND customer_tenant_id = app_current_tenant())
           OR (kind = 'RESPONSE' AND supplier_tenant_id = app_current_tenant()));--> statement-breakpoint
CREATE POLICY staff_moderates ON review_texts FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY other_party_reports ON review_texts FOR UPDATE
  USING (status = 'PUBLISHED'
         AND ((kind = 'REVIEW' AND supplier_tenant_id = app_current_tenant())
           OR (kind = 'RESPONSE' AND customer_tenant_id = app_current_tenant())))
  WITH CHECK (status = 'PENDING'
         AND ((kind = 'REVIEW' AND supplier_tenant_id = app_current_tenant())
           OR (kind = 'RESPONSE' AND customer_tenant_id = app_current_tenant())));
