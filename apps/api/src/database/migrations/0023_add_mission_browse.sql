-- T-054: investigator mission browse. Two additions:
--
-- `missions.published_at` — when a mission entered QUOTED, the moment investigators could first see
-- it. "Posted date" and "newest" need it, and nothing recorded it on the mission: the history row
-- that does is readable by the customer's workspace only. A trigger sets it, so every writer —
-- the transition service, a fixture, a future moderator path — gets it right without being asked.
--
-- `saved_mission_searches` — a browse an investigator saved, private to that user in that
-- workspace, like an assistant conversation (0019).

CREATE TABLE "saved_mission_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_mission_searches_owner_name_unique" UNIQUE("tenant_id","user_id","name")
);
--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saved_mission_searches" ADD CONSTRAINT "saved_mission_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_mission_searches" ADD CONSTRAINT "saved_mission_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_mission_searches_owner_idx" ON "saved_mission_searches" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "missions_published_idx" ON "missions" USING btree ("published_at","id") WHERE "missions"."status" = 'QUOTED';--> statement-breakpoint
CREATE INDEX "missions_location_gist" ON "missions" USING gist ("location") WHERE "missions"."status" = 'QUOTED';--> statement-breakpoint

-- ── missions.published_at ───────────────────────────────────────────────────────────────────────
-- Set on every entry into QUOTED (a mission suspended and published again is new again), and never
-- by a writer: a published_at supplied on the way in is overwritten, one supplied later is refused.
CREATE FUNCTION set_mission_published_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'QUOTED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'QUOTED') THEN
    NEW.published_at := now();
  ELSIF TG_OP = 'INSERT' THEN
    NEW.published_at := NULL;
  ELSIF NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'mission_published_at_is_derived: published_at is set by the database on entry into QUOTED'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'mission_published_at_is_derived';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER missions_published_at BEFORE INSERT OR UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION set_mission_published_at();--> statement-breakpoint

-- Backfill: the latest entry into QUOTED from the history, else the submission. Run with platform
-- access, transaction-locally, so row-level security (FORCEd on both tables) admits every row
-- whatever role runs the migration. In production this matches nothing yet: no path publishes
-- until the moderation queue (T-051). The trigger is disabled for the statement, since this is the
-- one writer allowed to set the column.
SELECT set_config('app.platform_access', 'on', true);--> statement-breakpoint
ALTER TABLE missions DISABLE TRIGGER missions_published_at;--> statement-breakpoint
UPDATE missions m SET published_at = COALESCE(
    (SELECT max(h.occurred_at) FROM mission_status_history h
      WHERE h.mission_id = m.id AND h.to_status = 'QUOTED'),
    m.submitted_at, m.updated_at)
  WHERE m.status = 'QUOTED' OR EXISTS (
    SELECT 1 FROM mission_status_history h WHERE h.mission_id = m.id AND h.to_status = 'QUOTED');--> statement-breakpoint
ALTER TABLE missions ENABLE TRIGGER missions_published_at;--> statement-breakpoint
SELECT set_config('app.platform_access', '', true);--> statement-breakpoint

-- ── saved_mission_searches ──────────────────────────────────────────────────────────────────────
ALTER TABLE "saved_mission_searches"
  ADD CONSTRAINT "saved_mission_searches_name_length" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  ADD CONSTRAINT "saved_mission_searches_filters_object" CHECK (jsonb_typeof("filters") = 'object');--> statement-breakpoint
CREATE TRIGGER saved_mission_searches_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON saved_mission_searches
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint

-- Saved, listed and deleted; never edited — saving under the same name again is a new search.
REVOKE ALL ON saved_mission_searches FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON saved_mission_searches TO investigator_app;--> statement-breakpoint

-- One user, one workspace. Not even an agency's owner reads a colleague's saved searches.
ALTER TABLE saved_mission_searches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE saved_mission_searches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_search ON saved_mission_searches FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());
