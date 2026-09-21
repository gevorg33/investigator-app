-- Reverses 0016_add_agency_registration.
DROP POLICY IF EXISTS own_owner_role_insert ON membership_roles;--> statement-breakpoint
CREATE POLICY personal_owner_insert ON membership_roles FOR INSERT
  WITH CHECK ((EXISTS (SELECT 1 FROM tenant_memberships m
              WHERE m.id = membership_roles.membership_id AND m.tenant_kind = 'PERSONAL'
                AND m.user_id = app_current_user())
     AND role_id IN (SELECT r.id FROM roles r WHERE r.key = 'OWNER' AND r.tenant_id IS NULL))
    OR app_platform_access());--> statement-breakpoint
DROP POLICY IF EXISTS own_membership_insert ON tenant_memberships;--> statement-breakpoint
CREATE POLICY personal_insert ON tenant_memberships FOR INSERT
  WITH CHECK ((tenant_kind = 'PERSONAL' AND user_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
DROP POLICY IF EXISTS own_update ON tenants;--> statement-breakpoint
CREATE POLICY own_update ON tenants FOR UPDATE
  USING (id = app_current_tenant() OR personal_owner_id = app_current_user() OR app_platform_access())
  WITH CHECK (id = app_current_tenant() OR personal_owner_id = app_current_user() OR app_platform_access());--> statement-breakpoint
DROP POLICY IF EXISTS own_workspace_insert ON tenants;--> statement-breakpoint
CREATE POLICY personal_insert ON tenants FOR INSERT
  WITH CHECK ((kind = 'PERSONAL' AND personal_owner_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
DROP POLICY IF EXISTS member_read ON tenants;--> statement-breakpoint
CREATE POLICY member_read ON tenants FOR SELECT
  USING (id = app_current_tenant()
    OR personal_owner_id = app_current_user()
    OR EXISTS (SELECT 1 FROM tenant_memberships m
                WHERE m.tenant_id = tenants.id AND m.user_id = app_current_user()
                  AND m.status = 'ACTIVE')
    OR app_platform_access());--> statement-breakpoint
DROP INDEX IF EXISTS tenants_created_by_idx;--> statement-breakpoint
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_currency_is_iso;--> statement-breakpoint
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_country_is_iso;--> statement-breakpoint
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_active_agency_is_complete;--> statement-breakpoint
ALTER TABLE tenants DROP COLUMN IF EXISTS currency;--> statement-breakpoint
ALTER TABLE tenants DROP COLUMN IF EXISTS timezone;--> statement-breakpoint
ALTER TABLE tenants DROP COLUMN IF EXISTS business_email;--> statement-breakpoint
ALTER TABLE tenants DROP COLUMN IF EXISTS country_code;--> statement-breakpoint
ALTER TABLE tenants DROP COLUMN IF EXISTS created_by;
