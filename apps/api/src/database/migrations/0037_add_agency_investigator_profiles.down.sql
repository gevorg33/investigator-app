-- Reverses 0037 (T-087). Roll back the application first: without the key, nothing stops a profile
-- being made for someone who is not a member of its workspace, and without listing_read discovery
-- cannot see the workspace it filters on. Agency-held profiles stay, and stay in their workspace.
DROP TRIGGER IF EXISTS tenant_memberships_withdraw_profile ON tenant_memberships;--> statement-breakpoint
DROP FUNCTION IF EXISTS withdraw_departed_member_profile();--> statement-breakpoint
DROP POLICY IF EXISTS listing_read ON tenants;--> statement-breakpoint
ALTER TABLE "investigator_profiles" DROP CONSTRAINT IF EXISTS "investigator_profiles_membership_fk";
