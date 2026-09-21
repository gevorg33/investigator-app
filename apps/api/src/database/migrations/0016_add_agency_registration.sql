-- T-083: a person may create an agency, and the database says so rather than trusting the code.
--
-- Until now the tenancy policies allowed exactly one thing to be created: your own Personal
-- workspace (T-077). An agency is the second, and it is a user action — not something that needs
-- platform access, which exists for staff and system work. So the rules say what is true: a
-- signed-in person may create an agency with themselves as its owner, and nothing else.
--
-- `created_by` is what makes that expressible. It is not an ownership record — ownership is the
-- OWNER role on a membership — it is who brought the workspace into being, which is the only
-- thing that distinguishes "an agency I am setting up" from "somebody else's agency" in the
-- moment before it has any members.
ALTER TABLE tenants ADD COLUMN created_by uuid;--> statement-breakpoint

-- The minimum an agency needs before it can be used. On the workspace row rather than in a
-- profile table: this is what the workspace *is*, the status rule reads it, and every query that
-- needs it already has the row. The fuller public profile and branding arrive with T-084.
ALTER TABLE tenants ADD COLUMN country_code text;--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN business_email text;--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN timezone text;--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN currency text;--> statement-breakpoint

-- An agency that cannot be identified, contacted, billed or scheduled has not finished being set
-- up, whatever its status column says — so say so, rather than inventing a country and a currency
-- for it. In production this matches nothing: the feature that creates agencies is this one.
UPDATE tenants SET status = 'CREATING'
 WHERE kind = 'AGENCY' AND status = 'ACTIVE'
   AND (name IS NULL OR country_code IS NULL OR business_email IS NULL
        OR timezone IS NULL OR currency IS NULL);--> statement-breakpoint

-- ACTIVE means usable, and an agency is not usable until it can be identified, contacted, billed
-- and scheduled. Enforced here so that no path — service, fixture or migration — can activate a
-- half-filled workspace. Personal workspaces are unaffected: they have none of these fields.
ALTER TABLE tenants ADD CONSTRAINT tenants_active_agency_is_complete CHECK (
  kind <> 'AGENCY' OR status <> 'ACTIVE'
  OR (name IS NOT NULL AND country_code IS NOT NULL AND business_email IS NOT NULL
      AND timezone IS NOT NULL AND currency IS NOT NULL));--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_country_is_iso CHECK (
  country_code IS NULL OR country_code ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_currency_is_iso CHECK (
  currency IS NULL OR currency ~ '^[A-Z]{3}$');--> statement-breakpoint

CREATE INDEX tenants_created_by_idx ON tenants (created_by) WHERE created_by IS NOT NULL;--> statement-breakpoint

-- The creator can see the workspace they are creating before it has a membership to see it
-- through — which is what `INSERT … RETURNING` needs, and what makes the next two statements
-- possible at all.
DROP POLICY member_read ON tenants;--> statement-breakpoint
CREATE POLICY member_read ON tenants FOR SELECT
  USING (id = app_current_tenant()
    OR personal_owner_id = app_current_user()
    OR created_by = app_current_user()
    OR EXISTS (SELECT 1 FROM tenant_memberships m
                WHERE m.tenant_id = tenants.id AND m.user_id = app_current_user()
                  AND m.status = 'ACTIVE')
    OR app_platform_access());--> statement-breakpoint

DROP POLICY personal_insert ON tenants;--> statement-breakpoint
CREATE POLICY own_workspace_insert ON tenants FOR INSERT
  WITH CHECK ((kind = 'PERSONAL' AND personal_owner_id = app_current_user())
    OR (kind = 'AGENCY' AND created_by = app_current_user() AND status = 'CREATING')
    OR app_platform_access());--> statement-breakpoint

-- Finishing the setup of an agency you created, before it is ACTIVE. After that the only way in
-- is from inside the workspace, where membership and permissions decide — so someone who created
-- an agency and was later removed from it has no lasting hold over it.
DROP POLICY own_update ON tenants;--> statement-breakpoint
CREATE POLICY own_update ON tenants FOR UPDATE
  USING (id = app_current_tenant()
    OR personal_owner_id = app_current_user()
    OR (created_by = app_current_user() AND status = 'CREATING')
    OR app_platform_access())
  WITH CHECK (id = app_current_tenant()
    OR personal_owner_id = app_current_user()
    OR (created_by = app_current_user() AND status IN ('CREATING', 'ACTIVE'))
    OR app_platform_access());--> statement-breakpoint

-- A membership in an agency you created, while it is still being set up: that is the owner
-- membership, and it is the only agency membership anyone can write for themselves. Joining an
-- existing agency is an invitation (T-085), which is somebody else's decision, not the joiner's.
DROP POLICY personal_insert ON tenant_memberships;--> statement-breakpoint
CREATE POLICY own_membership_insert ON tenant_memberships FOR INSERT
  WITH CHECK ((tenant_kind = 'PERSONAL' AND user_id = app_current_user())
    OR (tenant_kind = 'AGENCY' AND user_id = app_current_user()
        AND EXISTS (SELECT 1 FROM tenants t
                     WHERE t.id = tenant_memberships.tenant_id
                       AND t.created_by = app_current_user()
                       AND t.status = 'CREATING'))
    OR app_platform_access());--> statement-breakpoint

-- And the OWNER role on that membership, for the same window and no other.
DROP POLICY personal_owner_insert ON membership_roles;--> statement-breakpoint
CREATE POLICY own_owner_role_insert ON membership_roles FOR INSERT
  WITH CHECK ((EXISTS (SELECT 1 FROM tenant_memberships m
                        WHERE m.id = membership_roles.membership_id
                          AND m.user_id = app_current_user()
                          AND (m.tenant_kind = 'PERSONAL'
                               OR EXISTS (SELECT 1 FROM tenants t
                                           WHERE t.id = m.tenant_id
                                             AND t.created_by = app_current_user()
                                             AND t.status = 'CREATING')))
     AND role_id IN (SELECT r.id FROM roles r WHERE r.key = 'OWNER' AND r.tenant_id IS NULL))
    OR app_platform_access());
