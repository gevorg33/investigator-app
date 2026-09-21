-- T-080: an audit row says which workspace it happened in, and the row cannot say otherwise.
--
-- The three columns are filled by DEFAULT, from the same transaction-local settings the policies
-- read (T-075, T-077). Nothing in the application names them: `AuditEvent` has no field for a
-- workspace, a membership or a session, so there is nothing for a caller to get wrong or to
-- forge, and a row written by any path at all still records where it happened.
--
-- Nullable, because plenty of audited things happen outside a workspace: signing in, redeeming a
-- token, a refused workspace, a system operation. NULL there is the truth, not a gap.
CREATE FUNCTION app_current_membership() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(current_setting('app.membership_id', true), '')::uuid
$$;--> statement-breakpoint
CREATE FUNCTION app_current_session() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(current_setting('app.session_id', true), '')::uuid
$$;--> statement-breakpoint

ALTER TABLE audit_logs ADD COLUMN tenant_id uuid DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN membership_id uuid DEFAULT app_current_membership();--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN session_id uuid DEFAULT app_current_session();--> statement-breakpoint

-- No foreign keys, for the same reason the actor is not one: the entry has to outlive the
-- workspace, the membership and the session it describes.
CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, occurred_at DESC);--> statement-breakpoint

-- The policies T-077 deferred until this column existed.
--
-- A workspace reads its own rows; platform staff read across workspaces inside PlatformContext
-- (T-079), which is audited itself. Holding `audit.read` is checked above this, in the service
-- (T-078): a policy can see the settings, not the permission list, so the two layers answer
-- different halves of the question — which rows exist for this caller, and whether this caller
-- may ask at all.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_read ON audit_logs FOR SELECT
  USING (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
-- An entry belongs to the workspace the request is acting in, or to none. It may never be
-- written into someone else's.
CREATE POLICY workspace_insert ON audit_logs FOR INSERT
  WITH CHECK (tenant_id IS NOT DISTINCT FROM app_current_tenant() OR app_platform_access());
