-- Reverses 0013_add_row_level_security.

DROP POLICY IF EXISTS member_read ON tenants;--> statement-breakpoint
DROP POLICY IF EXISTS personal_insert ON tenants;--> statement-breakpoint
DROP POLICY IF EXISTS own_update ON tenants;--> statement-breakpoint
ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS own_or_workspace_read ON tenant_memberships;--> statement-breakpoint
DROP POLICY IF EXISTS personal_insert ON tenant_memberships;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_update ON tenant_memberships;--> statement-breakpoint
ALTER TABLE tenant_memberships NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenant_memberships DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS with_membership_read ON membership_roles;--> statement-breakpoint
DROP POLICY IF EXISTS personal_owner_insert ON membership_roles;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_delete ON membership_roles;--> statement-breakpoint
ALTER TABLE membership_roles NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE membership_roles DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON customer_profiles;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON customer_profiles;--> statement-breakpoint
ALTER TABLE customer_profiles NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE customer_profiles DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON investigator_profiles;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON investigator_profiles;--> statement-breakpoint
ALTER TABLE investigator_profiles NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_profiles DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON investigator_languages;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON investigator_languages;--> statement-breakpoint
ALTER TABLE investigator_languages NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_languages DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON investigator_specialties;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON investigator_specialties;--> statement-breakpoint
ALTER TABLE investigator_specialties NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_specialties DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON investigator_availability;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON investigator_availability;--> statement-breakpoint
ALTER TABLE investigator_availability NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_availability DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON service_areas;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON service_areas;--> statement-breakpoint
ALTER TABLE service_areas NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE service_areas DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON media_assets;--> statement-breakpoint
ALTER TABLE media_assets NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE media_assets DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON verification_requests;--> statement-breakpoint
ALTER TABLE verification_requests NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verification_requests DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON verification_request_documents;--> statement-breakpoint
ALTER TABLE verification_request_documents NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verification_request_documents DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON verification_decisions;--> statement-breakpoint
ALTER TABLE verification_decisions NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verification_decisions DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_rw ON idempotency_keys;--> statement-breakpoint
ALTER TABLE idempotency_keys NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_keys DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS customer_rw ON missions;--> statement-breakpoint
DROP POLICY IF EXISTS quoted_read ON missions;--> statement-breakpoint
DROP POLICY IF EXISTS supplier_read ON missions;--> statement-breakpoint
ALTER TABLE missions NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE missions DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS customer_rw ON mission_status_history;--> statement-breakpoint
ALTER TABLE mission_status_history NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mission_status_history DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS customer_rw ON mission_screenings;--> statement-breakpoint
ALTER TABLE mission_screenings NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mission_screenings DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS parties ON quotes;--> statement-breakpoint
ALTER TABLE quotes NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE quotes DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS parties ON assignments;--> statement-breakpoint
ALTER TABLE assignments NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE assignments DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS parties ON assignment_status_history;--> statement-breakpoint
ALTER TABLE assignment_status_history NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE assignment_status_history DISABLE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'st_dwithin(geography, geography, double precision, boolean)',
    '_st_dwithin(geography, geography, double precision, boolean)',
    'geography_overlaps(geography, geography)',
    'overlaps_geog(geography, gidx)'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s NOT LEAKPROOF', target);
    EXCEPTION
      WHEN insufficient_privilege OR undefined_function THEN NULL;
    END;
  END LOOP;
END $$;--> statement-breakpoint
ALTER FUNCTION assert_personal_member_is_owner() RESET app.platform_access;--> statement-breakpoint
ALTER FUNCTION assert_tenant_has_owner() RESET app.platform_access;--> statement-breakpoint
CREATE OR REPLACE FUNCTION create_personal_workspace() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  workspace uuid;
  membership uuid;
BEGIN
  INSERT INTO tenants (kind, status, personal_owner_id)
  VALUES ('PERSONAL', 'ACTIVE', NEW.id)
  RETURNING id INTO workspace;

  INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id, status)
  VALUES (workspace, 'PERSONAL', NEW.id, 'ACTIVE')
  RETURNING id INTO membership;

  INSERT INTO membership_roles (membership_id, role_id)
  SELECT membership, r.id FROM roles r WHERE r.key = 'OWNER' AND r.tenant_id IS NULL;

  RETURN NULL;
END $$;--> statement-breakpoint
DROP FUNCTION IF EXISTS app_platform_access();--> statement-breakpoint
DROP FUNCTION IF EXISTS app_current_user();
