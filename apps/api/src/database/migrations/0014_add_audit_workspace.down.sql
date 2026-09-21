-- Reverses 0014_add_audit_workspace.
DROP POLICY IF EXISTS workspace_insert ON audit_logs;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_read ON audit_logs;--> statement-breakpoint
ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX IF EXISTS audit_logs_tenant_idx;--> statement-breakpoint
ALTER TABLE audit_logs DROP COLUMN IF EXISTS session_id;--> statement-breakpoint
ALTER TABLE audit_logs DROP COLUMN IF EXISTS membership_id;--> statement-breakpoint
ALTER TABLE audit_logs DROP COLUMN IF EXISTS tenant_id;--> statement-breakpoint
DROP FUNCTION IF EXISTS app_current_session();--> statement-breakpoint
DROP FUNCTION IF EXISTS app_current_membership();
