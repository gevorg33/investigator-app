-- T-052: blocking another user — one person refusing future engagement with another.
--
-- Between people, not workspaces. The row is the blocker's alone: the blocked person cannot read
-- it, so cannot learn they were blocked. Enforcement still has to act in the blocked person's own
-- context — their browse must lose the blocker's missions, their quote must be refused — so it
-- reads the blocks through one function that runs as its owner, `app_blocked_users()`.
--
-- That function is the repository's first SECURITY DEFINER (owner decision, 2026-09-30). It is
-- deliberately narrow: no arguments, a fixed search_path, and it answers one question about the
-- current user only — the people blocked either way with them — never who blocked whom. The
-- application never returns it; it is used inside policies and queries.

CREATE TABLE "user_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" uuid DEFAULT app_current_user() NOT NULL,
	"blocked_id" uuid NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"blocked_profile_id" uuid,
	"source" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_profile_id_investigator_profiles_id_fk" FOREIGN KEY ("blocked_profile_id") REFERENCES "public"."investigator_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_blocks_pair_unique" ON "user_blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");
--> statement-breakpoint

ALTER TABLE user_blocks
  ADD CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id),
  ADD CONSTRAINT user_blocks_source CHECK (source IN ('profile', 'mission', 'assignment')),
  ADD CONSTRAINT user_blocks_label_length CHECK (label IS NULL OR char_length(label) <= 200);--> statement-breakpoint

CREATE TRIGGER user_blocks_tenant_immutable BEFORE UPDATE OF tenant_id, blocker_id, blocked_id
  ON user_blocks FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'blocker_id', 'blocked_id');--> statement-breakpoint

-- Made and removed, never edited: unblocking deletes the row, and the audit trail keeps both.
REVOKE ALL ON user_blocks FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON user_blocks TO investigator_app;--> statement-breakpoint

ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE user_blocks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The blocker's own, from any workspace they are in; made in the workspace they are in.
CREATE POLICY own_blocks ON user_blocks FOR ALL
  USING (blocker_id = app_current_user() OR app_platform_access())
  WITH CHECK ((blocker_id = app_current_user() AND tenant_id = app_current_tenant()) OR app_platform_access());--> statement-breakpoint
-- The function below runs as the owner of this migration. With FORCE, row-level security applies
-- to an owner that is not a superuser too, so the owner — and only the owner — reads every row.
CREATE POLICY blocked_set ON user_blocks FOR SELECT TO CURRENT_USER USING (true);--> statement-breakpoint

CREATE FUNCTION app_blocked_users() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    array_agg(CASE WHEN b.blocker_id = app_current_user() THEN b.blocked_id ELSE b.blocker_id END),
    '{}'::uuid[])
  FROM user_blocks b
  WHERE app_current_user() IS NOT NULL
    AND (b.blocker_id = app_current_user() OR b.blocked_id = app_current_user())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_blocked_users() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_blocked_users() TO investigator_app;--> statement-breakpoint

-- A published mission is not shown to anyone blocked either way with its customer. Wrapped in a
-- sub-select so it is evaluated once per statement, not once per row.
DROP POLICY quoted_read ON missions;--> statement-breakpoint
CREATE POLICY quoted_read ON missions FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND status = 'QUOTED'
         AND customer_id <> ALL ((SELECT app_blocked_users())::uuid[]));--> statement-breakpoint

-- Nor can they quote on one — not even on a mission still visible to them through an earlier,
-- withdrawn quote. Restrictive: it narrows the parties policy, it grants nothing.
CREATE POLICY not_blocked ON quotes AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_platform_access() OR NOT EXISTS (
    SELECT 1 FROM missions m
     WHERE m.id = quotes.mission_id AND m.customer_id = ANY ((SELECT app_blocked_users())::uuid[])));
