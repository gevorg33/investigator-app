-- Legal holds (T-035): data that must not be deleted, whatever retention says. A hold names one
-- resource; it is placed in force, released once with a reason, and never rewritten or deleted.

CREATE TYPE "public"."legal_hold_resource" AS ENUM('USER', 'TENANT', 'MISSION', 'ASSIGNMENT', 'MEDIA_ASSET');--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" "legal_hold_resource" NOT NULL,
	"resource_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"release_reason" text,
	CONSTRAINT "legal_holds_reason_length" CHECK (length(btrim("legal_holds"."reason")) BETWEEN 1 AND 2000),
	CONSTRAINT "legal_holds_release_complete" CHECK (("legal_holds"."released_at" IS NULL AND "legal_holds"."released_by" IS NULL AND "legal_holds"."release_reason" IS NULL)
          OR ("legal_holds"."released_at" IS NOT NULL AND "legal_holds"."released_by" IS NOT NULL
              AND length(btrim("legal_holds"."release_reason")) BETWEEN 1 AND 2000)),
	CONSTRAINT "legal_holds_release_after_placing" CHECK ("legal_holds"."released_at" IS NULL OR "legal_holds"."released_at" >= "legal_holds"."placed_at")
);
--> statement-breakpoint
CREATE INDEX "legal_holds_active_idx" ON "legal_holds" USING btree ("resource_type","resource_id") WHERE "legal_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "legal_holds_placed_idx" ON "legal_holds" USING btree ("placed_at","id");--> statement-breakpoint

-- ── kept, whoever the writer is ─────────────────────────────────────────────────────────────────
-- A hold is placed in force. After that the only change is its release — all three release fields,
-- once — and nothing else about it ever changes: what was held, why, by whom and since when is the
-- record a court or a regulator will ask for.
CREATE FUNCTION check_legal_hold() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'legal_hold_placed_in_force: a hold is placed in force and released afterwards'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'legal_hold_placed_in_force';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
     OR (to_jsonb(NEW) - ARRAY['released_at', 'released_by', 'release_reason'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['released_at', 'released_by', 'release_reason']) THEN
    RAISE EXCEPTION 'legal_hold_released_once: a hold is never rewritten; it may be released once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'legal_hold_released_once';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER legal_holds_checked BEFORE INSERT OR UPDATE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION check_legal_hold();--> statement-breakpoint

-- Not even the owner deletes one: a released hold is still the record that the data was preserved,
-- and when. If released holds ever get a retention period, the migration that sets it lifts this.
CREATE FUNCTION forbid_legal_hold_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'legal_hold_never_deleted: a legal hold is released, never deleted'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'legal_hold_never_deleted';
END $$;--> statement-breakpoint
CREATE TRIGGER legal_holds_never_deleted BEFORE DELETE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION forbid_legal_hold_delete();--> statement-breakpoint

-- ── grants: UPDATE for the release alone (the trigger), DELETE never ────────────────────────────
REVOKE ALL ON legal_holds FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON legal_holds TO investigator_app;--> statement-breakpoint

-- ── row-level security ──────────────────────────────────────────────────────────────────────────
-- Platform access only: COMPLIANCE staff placing and releasing, and retention jobs running as the
-- system. Outside it a hold is invisible, so a retention path that forgot to enter would see none —
-- which is why RetentionGuard refuses to run outside platform access rather than trust the answer.
ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE legal_holds FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON legal_holds FOR ALL
  USING (app_platform_access()) WITH CHECK (app_platform_access());
