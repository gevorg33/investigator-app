-- Investigator profiles under workspaces (T-087, tenancy.md §2 and §5). A profile belongs to a
-- workspace and is held by one membership of it; an agency runs several, one per person.

-- ── investigator_profiles: held by a membership of its own workspace ────────────────────────────
-- Every existing profile is in its owner's Personal workspace, whose OWNER membership the
-- registration trigger made with the user (migration 0011), so this validates against what is
-- there. Deferred to commit, like the membership's own key on users: deleting a user cascades
-- their Personal workspace, its membership and their profiles within one statement.
ALTER TABLE "investigator_profiles" ADD CONSTRAINT "investigator_profiles_membership_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- ── tenants: the workspace behind a published investigator profile ──────────────────────────────
-- Discovery lists a profile only while its workspace is ACTIVE, and names the agency it belongs to,
-- so the workspace row must be readable wherever the profile is. The service selects the kind,
-- status and name, nothing else. investigator_profiles' policies never join back to tenants.
CREATE POLICY listing_read ON tenants FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND EXISTS (
    SELECT 1 FROM investigator_profiles p
     WHERE p.tenant_id = tenants.id AND p.visibility = 'PUBLISHED'));--> statement-breakpoint

-- ── tenant_memberships: a member who leaves takes their profile out of the listing ───────────────
-- Suspended or removed, the holder can no longer act for the workspace, so their profile there stops
-- being offered: back to a draft, not accepting work. Reactivating does not republish it; the
-- workspace decides that again. Runs with the writer's own rights, never raised: the only writers
-- that can move a membership's status (workspace_update, platform access — migration 0013) are the
-- workspace itself and platform staff, and both may update that workspace's profiles.
CREATE FUNCTION withdraw_departed_member_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE investigator_profiles
     SET visibility = 'DRAFT', accepting_work = false, updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND (visibility <> 'DRAFT' OR accepting_work);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER tenant_memberships_withdraw_profile AFTER UPDATE OF status ON tenant_memberships
  FOR EACH ROW WHEN (OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE')
  EXECUTE FUNCTION withdraw_departed_member_profile();
