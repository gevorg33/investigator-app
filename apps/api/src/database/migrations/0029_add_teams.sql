-- T-086: an agency's teams, and who is in them (tenancy.md §4).
--
-- `teams` — a name (unique per agency, whatever the case) and what it is for. `team_members` —
-- which membership is in which team, `tenant_id` denormalised and held equal to both the team's and
-- the membership's by composite keys, so nobody can be put in another agency's team, whoever
-- writes. Both are private to their workspace.
--
-- A removed member leaves every team, by trigger, whoever removes them; a removed member cannot be
-- put in one. A suspended member stays in their teams, as they keep their roles.
-- What a row naming a membership in its own workspace points at.
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_pk" PRIMARY KEY("team_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_fk" FOREIGN KEY ("team_id","tenant_id") REFERENCES "public"."teams"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_membership_fk" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "public"."tenant_memberships"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_tenant_membership_idx" ON "team_members" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_tenant_name_unique" ON "teams" USING btree ("tenant_id",lower("name"));--> statement-breakpoint--> statement-breakpoint
ALTER TABLE "teams"
  ADD CONSTRAINT "teams_name_length" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  ADD CONSTRAINT "teams_description_length" CHECK ("description" IS NULL OR length(btrim("description")) BETWEEN 1 AND 500);--> statement-breakpoint
CREATE TRIGGER teams_tenant_immutable BEFORE UPDATE OF tenant_id ON teams
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
-- A membership is added to or taken out of a team; the row itself never changes — the application
-- holds no UPDATE on it, and the move guard says so in the database as well.
CREATE TRIGGER team_members_tenant_immutable BEFORE UPDATE OF tenant_id, team_id, membership_id
  ON team_members FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'team_id', 'membership_id');--> statement-breakpoint
CREATE FUNCTION assert_team_member_not_removed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.id = NEW.membership_id AND m.status = 'REMOVED') THEN
    RAISE EXCEPTION 'team_members_member_present: a removed member cannot join a team'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'team_members_member_present';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER team_members_member_present BEFORE INSERT ON team_members
  FOR EACH ROW EXECUTE FUNCTION assert_team_member_not_removed();--> statement-breakpoint
-- Removing someone from the agency takes them out of every team. Whoever can set REMOVED can see
-- the workspace's team rows (tenant_memberships.workspace_update), so this needs no raised access.
CREATE FUNCTION leave_teams_on_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM team_members WHERE membership_id = NEW.id AND tenant_id = NEW.tenant_id;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER tenant_memberships_leave_teams AFTER UPDATE OF status ON tenant_memberships
  FOR EACH ROW WHEN (NEW.status = 'REMOVED' AND OLD.status <> 'REMOVED')
  EXECUTE FUNCTION leave_teams_on_removal();--> statement-breakpoint
-- A team is created, renamed and deleted (its members with it); membership rows are added and taken
-- away, never edited.
REVOKE ALL ON teams FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON teams TO investigator_app;--> statement-breakpoint
REVOKE ALL ON team_members FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON team_members TO investigator_app;--> statement-breakpoint
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE teams FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON teams FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON team_members FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access())