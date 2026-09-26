-- Reverses 0029_add_teams.
DROP TRIGGER IF EXISTS tenant_memberships_leave_teams ON tenant_memberships;--> statement-breakpoint
DROP FUNCTION IF EXISTS leave_teams_on_removal();--> statement-breakpoint
DROP TABLE IF EXISTS team_members;--> statement-breakpoint
DROP FUNCTION IF EXISTS assert_team_member_not_removed();--> statement-breakpoint
DROP TABLE IF EXISTS teams;--> statement-breakpoint
ALTER TABLE tenant_memberships DROP CONSTRAINT IF EXISTS tenant_memberships_id_tenant_unique;
