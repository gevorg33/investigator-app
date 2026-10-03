-- Moderation decisions (T-051): the publication gate's own record. One row per decision on a mission
-- under review — publish, reject or request changes — append-only, read by staff alone.

CREATE TYPE "public"."mission_moderation_outcome" AS ENUM('PUBLISHED', 'REJECTED', 'CHANGES_REQUESTED');--> statement-breakpoint
CREATE TABLE "mission_moderation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"mission_version" integer NOT NULL,
	"screening_id" uuid NOT NULL,
	"outcome" "mission_moderation_outcome" NOT NULL,
	"reason" text NOT NULL,
	"internal_note" text,
	"decided_by" uuid NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taxonomy_node_id" uuid,
	"risk_band" "risk_band" NOT NULL,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_moderation_decisions" ADD CONSTRAINT "mission_moderation_decisions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_moderation_decisions" ADD CONSTRAINT "mission_moderation_decisions_screening_id_mission_screenings_id_fk" FOREIGN KEY ("screening_id") REFERENCES "public"."mission_screenings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_moderation_decisions" ADD CONSTRAINT "mission_moderation_decisions_taxonomy_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("taxonomy_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_moderation_decisions" ADD CONSTRAINT "mission_moderation_decisions_mission_tenant_fk" FOREIGN KEY ("mission_id","customer_tenant_id") REFERENCES "public"."missions"("id","customer_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_moderation_decisions_mission_idx" ON "mission_moderation_decisions" USING btree ("customer_tenant_id","mission_id","decided_at");--> statement-breakpoint

-- ── what a decision must carry ──────────────────────────────────────────────────────────────────
-- A reason for every outcome, with something in it: for a rejection or a return it is what the
-- customer reads, and a reason of spaces tells them nothing. The note is optional, never empty.
ALTER TABLE "mission_moderation_decisions"
  ADD CONSTRAINT "mission_moderation_decisions_reason_length" CHECK (
    length(btrim("reason")) BETWEEN 1 AND 2000
  ),
  ADD CONSTRAINT "mission_moderation_decisions_note_length" CHECK (
    "internal_note" IS NULL OR length(btrim("internal_note")) BETWEEN 1 AND 4000
  ),
  ADD CONSTRAINT "mission_moderation_decisions_version_positive" CHECK ("mission_version" >= 1),
  -- Latency is decided − queued, so it is never negative.
  ADD CONSTRAINT "mission_moderation_decisions_after_queue" CHECK ("decided_at" >= "queued_at");--> statement-breakpoint

-- The screening shown is this mission's, not another's.
ALTER TABLE "mission_screenings"
  ADD CONSTRAINT "mission_screenings_id_mission_unique" UNIQUE ("id", "mission_id");--> statement-breakpoint
ALTER TABLE "mission_moderation_decisions"
  ADD CONSTRAINT "mission_moderation_decisions_screening_of_mission_fk"
  FOREIGN KEY ("screening_id", "mission_id")
  REFERENCES "public"."mission_screenings"("id", "mission_id") ON DELETE restrict;--> statement-breakpoint

-- ── the party column comes from the mission, never from the request ─────────────────────────────
CREATE TRIGGER mission_moderation_decisions_fill_from_mission BEFORE INSERT ON mission_moderation_decisions
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('missions', 'mission_id', 'customer_tenant_id:customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER mission_moderation_decisions_tenant_immutable BEFORE UPDATE OF customer_tenant_id ON mission_moderation_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id');--> statement-breakpoint

-- ── grants: append-only. The REVOKEs do the work; UPDATE and DELETE are never granted ───────────
REVOKE ALL ON mission_moderation_decisions FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT ON mission_moderation_decisions TO investigator_app;--> statement-breakpoint

-- ── row-level security ──────────────────────────────────────────────────────────────────────────
-- Staff decide, inside PlatformContext, and only staff read: the internal note is never the
-- customer's, and the customer's view of a decision is its row in mission_status_history.
ALTER TABLE mission_moderation_decisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mission_moderation_decisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_only ON mission_moderation_decisions FOR ALL
  USING (app_platform_access()) WITH CHECK (app_platform_access());
