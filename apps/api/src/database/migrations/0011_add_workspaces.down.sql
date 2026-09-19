-- Reverse of 0011. db-migration requires every migration to have a working down path.
DROP TRIGGER IF EXISTS users_create_personal_workspace ON users;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenants_have_an_owner ON tenants;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_memberships_keep_an_owner ON tenant_memberships;--> statement-breakpoint
DROP TRIGGER IF EXISTS membership_roles_keep_an_owner ON membership_roles;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_memberships_personal_is_owner ON tenant_memberships;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenants_identity_immutable ON tenants;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_memberships_identity_immutable ON tenant_memberships;--> statement-breakpoint
DROP FUNCTION IF EXISTS create_personal_workspace();--> statement-breakpoint
DROP FUNCTION IF EXISTS assert_tenant_has_owner();--> statement-breakpoint
DROP FUNCTION IF EXISTS assert_personal_member_is_owner();--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_identity_change();--> statement-breakpoint

ALTER TABLE "user_sessions" DROP CONSTRAINT IF EXISTS "user_sessions_default_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "user_sessions" DROP COLUMN IF EXISTS "default_tenant_id";--> statement-breakpoint

-- Children first.
DROP TABLE IF EXISTS "membership_roles";--> statement-breakpoint
DROP TABLE IF EXISTS "role_permissions";--> statement-breakpoint
DROP TABLE IF EXISTS "roles";--> statement-breakpoint
DROP TABLE IF EXISTS "permissions";--> statement-breakpoint
DROP TABLE IF EXISTS "tenant_memberships";--> statement-breakpoint
DROP TABLE IF EXISTS "tenants";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."membership_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."tenant_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."tenant_kind";
