-- Reverses 0028_add_employees.
DROP TRIGGER IF EXISTS tenant_memberships_archive_sessions ON tenant_memberships;--> statement-breakpoint
DROP FUNCTION IF EXISTS archive_departed_member_sessions();--> statement-breakpoint
DROP POLICY IF EXISTS invited_role_insert ON membership_roles;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_insert ON membership_roles;--> statement-breakpoint
DROP POLICY IF EXISTS invited_rejoin ON tenant_memberships;--> statement-breakpoint
DROP POLICY IF EXISTS invited_insert ON tenant_memberships;--> statement-breakpoint
DROP TABLE IF EXISTS tenant_invitations;--> statement-breakpoint
DROP FUNCTION IF EXISTS app_current_confirmed_email();--> statement-breakpoint
DROP TYPE IF EXISTS invitation_status;--> statement-breakpoint
ALTER TABLE tenant_memberships
  DROP CONSTRAINT IF EXISTS tenant_memberships_timezone_length,
  DROP CONSTRAINT IF EXISTS tenant_memberships_locale_known,
  DROP CONSTRAINT IF EXISTS tenant_memberships_employee_text,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS locale,
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS job_title;
