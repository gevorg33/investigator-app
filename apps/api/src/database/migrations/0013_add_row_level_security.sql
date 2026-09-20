-- T-077: row-level security. PostgreSQL enforces the workspace, whatever the code above it does.
--
-- Every workspace-scoped table, and the tenancy tables, get ENABLE and FORCE (FORCE so the owner
-- is held too — only a superuser, which the runtime role can never be, passes through). Policies
-- compare columns the rows already carry (T-076) and never join a table whose policy joins back.
--
-- What the settings mean (set transaction-locally by the scoped client, T-075):
--   app.tenant_id        the workspace a request acts in; no context reads as NULL, matching nothing
--   app.user_id          who is acting. Alone, it is the pre-workspace context: the resolver reads
--                        the caller's own memberships and workspaces with it, and nothing else
--   app.platform_access  'on' only inside PlatformContext (staff review, system operations)
--
-- Tables left without RLS, by class (table-classes.ts): identity (T-098 decides), platform
-- (read-only by grant), audit_logs (T-080 adds its tenant column), outbox_events (T-082),
-- spatial_ref_sys (PostGIS).

CREATE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;--> statement-breakpoint
CREATE FUNCTION app_platform_access() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(current_setting('app.platform_access', true), '') = 'on'
$$;--> statement-breakpoint

-- Registration runs before any workspace exists. The trigger acts as the person it is creating,
-- for its own three inserts only, then puts back whatever was there: the policies below let a user
-- create exactly their own Personal workspace, its owner membership and that membership's OWNER role.
CREATE OR REPLACE FUNCTION create_personal_workspace() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  workspace uuid;
  membership uuid;
  previous text := COALESCE(current_setting('app.user_id', true), '');
BEGIN
  PERFORM set_config('app.user_id', NEW.id::text, true);

  INSERT INTO tenants (kind, status, personal_owner_id)
  VALUES ('PERSONAL', 'ACTIVE', NEW.id)
  RETURNING id INTO workspace;

  INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id, status)
  VALUES (workspace, 'PERSONAL', NEW.id, 'ACTIVE')
  RETURNING id INTO membership;

  INSERT INTO membership_roles (membership_id, role_id)
  SELECT membership, r.id FROM roles r WHERE r.key = 'OWNER' AND r.tenant_id IS NULL;

  PERFORM set_config('app.user_id', previous, true);
  RETURN NULL;
END $$;--> statement-breakpoint

-- The tenancy invariants must hold whoever is writing. An invariant evaluated under the writer's
-- visibility fails OPEN: assert_tenant_has_owner returns early when it cannot see the workspace.
-- Both checks only read; the SET clause scopes the access to the function call and restores the
-- caller's value on exit. These are the only database functions that raise platform access
-- (rls.spec.ts lists them).
ALTER FUNCTION assert_tenant_has_owner() SET app.platform_access = 'on';--> statement-breakpoint
ALTER FUNCTION assert_personal_member_is_owner() SET app.platform_access = 'on';--> statement-breakpoint


-- Discovery keeps its GIST index (owner decision, 2026-09-20).
--
-- A table with row-level security evaluates its security quals before any user qual that is not
-- LEAKPROOF, so a non-leakproof qual can no longer be an index condition. PostGIS does not mark
-- ST_DWithin leakproof, so `ST_DWithin(area, point, radius)` stopped reaching
-- `service_areas_area_gist`: measured on 10,000 published profiles, discovery went from 5 ms to
-- 392 ms. Marked leakproof, it is 3 ms.
--
-- These four are pure geometry maths over their arguments. What is being accepted is that an
-- error raised inside one — or the time it takes — could in principle say something about a row
-- the policy hides, which here means the coordinates of an unpublished profile's service area;
-- a published one's are public by design.
--
-- Only a superuser may mark a function leakproof. Where the migration runs as a non-superuser
-- owner it says so and carries on: the database is correct either way, only slower, and
-- `rls.spec.ts` fails until someone with the right to do it runs this (ACTIONS-FOR-ME #19).
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
      EXECUTE format('ALTER FUNCTION %s LEAKPROOF', target);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE WARNING 'not superuser: % stays non-leakproof, and discovery loses its GIST index (T-077)', target;
      WHEN undefined_function THEN
        RAISE WARNING 'no such function to mark leakproof: % (T-077)', target;
    END;
  END LOOP;
END $$;--> statement-breakpoint


-- tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY member_read ON tenants FOR SELECT
  USING (id = app_current_tenant()
    OR personal_owner_id = app_current_user()
    OR EXISTS (SELECT 1 FROM tenant_memberships m
                WHERE m.tenant_id = tenants.id AND m.user_id = app_current_user()
                  AND m.status = 'ACTIVE')
    OR app_platform_access());--> statement-breakpoint
CREATE POLICY personal_insert ON tenants FOR INSERT
  WITH CHECK ((kind = 'PERSONAL' AND personal_owner_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
CREATE POLICY own_update ON tenants FOR UPDATE
  USING (id = app_current_tenant() OR personal_owner_id = app_current_user() OR app_platform_access())
  WITH CHECK (id = app_current_tenant() OR personal_owner_id = app_current_user() OR app_platform_access());--> statement-breakpoint

-- tenant_memberships
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_or_workspace_read ON tenant_memberships FOR SELECT
  USING (user_id = app_current_user() OR tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY personal_insert ON tenant_memberships FOR INSERT
  WITH CHECK ((tenant_kind = 'PERSONAL' AND user_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
CREATE POLICY workspace_update ON tenant_memberships FOR UPDATE
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- membership_roles
ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE membership_roles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY with_membership_read ON membership_roles FOR SELECT
  USING (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.id = membership_roles.membership_id));--> statement-breakpoint
CREATE POLICY personal_owner_insert ON membership_roles FOR INSERT
  WITH CHECK ((EXISTS (SELECT 1 FROM tenant_memberships m
              WHERE m.id = membership_roles.membership_id AND m.tenant_kind = 'PERSONAL'
                AND m.user_id = app_current_user())
     AND role_id IN (SELECT r.id FROM roles r WHERE r.key = 'OWNER' AND r.tenant_id IS NULL))
    OR app_platform_access());--> statement-breakpoint
CREATE POLICY workspace_delete ON membership_roles FOR DELETE
  USING (EXISTS (SELECT 1 FROM tenant_memberships m
             WHERE m.id = membership_roles.membership_id AND m.tenant_id = app_current_tenant())
    OR app_platform_access());--> statement-breakpoint

-- customer_profiles
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE customer_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON customer_profiles FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON customer_profiles FOR SELECT
  USING (app_current_tenant() IS NOT NULL);--> statement-breakpoint

-- investigator_profiles
ALTER TABLE investigator_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON investigator_profiles FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON investigator_profiles FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND visibility = 'PUBLISHED');--> statement-breakpoint

-- investigator_languages
ALTER TABLE investigator_languages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_languages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON investigator_languages FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON investigator_languages FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND EXISTS (
    SELECT 1 FROM investigator_profiles p
     WHERE p.id = investigator_languages.profile_id AND p.visibility = 'PUBLISHED'));--> statement-breakpoint

-- investigator_specialties
ALTER TABLE investigator_specialties ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_specialties FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON investigator_specialties FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON investigator_specialties FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND EXISTS (
    SELECT 1 FROM investigator_profiles p
     WHERE p.id = investigator_specialties.profile_id AND p.visibility = 'PUBLISHED'));--> statement-breakpoint

-- investigator_availability
ALTER TABLE investigator_availability ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigator_availability FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON investigator_availability FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON investigator_availability FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND EXISTS (
    SELECT 1 FROM investigator_profiles p
     WHERE p.id = investigator_availability.profile_id AND p.visibility = 'PUBLISHED'));--> statement-breakpoint

-- service_areas
ALTER TABLE service_areas ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE service_areas FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON service_areas FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY public_read ON service_areas FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND EXISTS (
    SELECT 1 FROM investigator_profiles p
     WHERE p.id = service_areas.profile_id AND p.visibility = 'PUBLISHED'));--> statement-breakpoint

-- media_assets
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON media_assets FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- verification_requests
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verification_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON verification_requests FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- verification_request_documents
ALTER TABLE verification_request_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verification_request_documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON verification_request_documents FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- verification_decisions
ALTER TABLE verification_decisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verification_decisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON verification_decisions FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- idempotency_keys
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON idempotency_keys FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- missions
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE missions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY customer_rw ON missions FOR ALL
  USING (customer_tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (customer_tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY quoted_read ON missions FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND status = 'QUOTED');--> statement-breakpoint
CREATE POLICY supplier_read ON missions FOR SELECT
  USING (EXISTS (SELECT 1 FROM quotes q
             WHERE q.mission_id = missions.id AND q.supplier_tenant_id = app_current_tenant()));--> statement-breakpoint

-- mission_status_history
ALTER TABLE mission_status_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mission_status_history FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY customer_rw ON mission_status_history FOR ALL
  USING (customer_tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (customer_tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- mission_screenings
ALTER TABLE mission_screenings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mission_screenings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY customer_rw ON mission_screenings FOR ALL
  USING (customer_tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (customer_tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- quotes
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE quotes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY parties ON quotes FOR ALL
  USING (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access())
  WITH CHECK (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access());--> statement-breakpoint

-- assignments
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE assignments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY parties ON assignments FOR ALL
  USING (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access())
  WITH CHECK (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access());--> statement-breakpoint

-- assignment_status_history
ALTER TABLE assignment_status_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE assignment_status_history FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY parties ON assignment_status_history FOR ALL
  USING (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access())
  WITH CHECK (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access());
