CREATE TYPE "public"."membership_status" AS ENUM('ACTIVE', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."tenant_kind" AS ENUM('PERSONAL', 'AGENCY');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('CREATING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED');--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_membership_id_role_id_pk" PRIMARY KEY("membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_kind" "tenant_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "tenant_kind" NOT NULL,
	"status" "tenant_status" DEFAULT 'CREATING' NOT NULL,
	"name" text,
	"personal_owner_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_id_kind_unique" UNIQUE("id","kind")
);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "default_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_tenant_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."tenant_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_fk" FOREIGN KEY ("tenant_id","tenant_kind") REFERENCES "public"."tenants"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_personal_owner_id_users_id_fk" FOREIGN KEY ("personal_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_roles_role_idx" ON "membership_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_unique" ON "roles" USING btree ("key") WHERE "roles"."tenant_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key_unique" ON "roles" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_memberships_tenant_user_unique" ON "tenant_memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_memberships_one_per_personal" ON "tenant_memberships" USING btree ("tenant_id") WHERE "tenant_memberships"."tenant_kind" = 'PERSONAL';--> statement-breakpoint
CREATE INDEX "tenant_memberships_user_idx" ON "tenant_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_one_personal_per_user" ON "tenants" USING btree ("personal_owner_id");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("kind","status");--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_default_tenant_id_tenants_id_fk" FOREIGN KEY ("default_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Hand-written below this line: CHECKs, the seeded catalog, triggers, the backfill of existing
-- users, and grants. Migration 0000's ALTER DEFAULT PRIVILEGES makes every new table fully
-- writable, so withholding a privilege means REVOKING it.
--
-- The repo's first triggers (owner decision, 2026-09-19): invariants that must hold whoever the
-- writer is — registration, Google sign-in, an admin script, a test fixture, a bug. Each runs
-- with the INVOKER's privileges (never SECURITY DEFINER) and a fixed search_path.
-- ---------------------------------------------------------------------------

-- Checked at commit, not per statement. Deleting a user cascades to their Personal workspace and
-- from there to its membership — but Postgres runs this constraint's check before that nested
-- cascade has happened, so a NO ACTION check refused to delete even a user with nothing but a
-- Personal workspace (seen in identities.spec). Deferred, it runs after every cascade: an agency
-- membership, which nothing cascades away, still blocks the delete.
ALTER TABLE "tenant_memberships" ALTER CONSTRAINT "tenant_memberships_user_id_users_id_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- A Personal workspace has an owner and no name; an agency has a name and no owner column.
-- "name IS NOT NULL" is not redundant: with a NULL name, `name ~ '\S'` is NULL, not false, and a
-- CHECK that evaluates to NULL passes — an agency with no name was accepted until a test said so.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_personal_has_owner" CHECK (
  ("kind" = 'PERSONAL') = ("personal_owner_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_name_by_kind" CHECK (
  ("kind" = 'PERSONAL' AND "name" IS NULL)
  OR ("kind" = 'AGENCY' AND "name" IS NOT NULL AND "name" ~ '\S' AND length("name") <= 200)
);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_version_positive" CHECK ("version" >= 1);--> statement-breakpoint

ALTER TABLE "permissions" ADD CONSTRAINT "permissions_key_format" CHECK ("key" ~ '^[a-z]+\.[a-z_]+$');--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_description_present" CHECK ("description" ~ '\S');--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_format" CHECK ("key" ~ '^[A-Z][A-Z_]*$');--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_name_present" CHECK ("name" ~ '\S' AND length("name") <= 100);--> statement-breakpoint

-- The permission catalog: data, not code (tenancy.md §3). Generated from that table; the spec
-- `tenants.spec.ts` parses the same table and fails if the two ever disagree.

INSERT INTO permissions (key, description) VALUES
  ('company.read', 'See the workspace profile and details'),
  ('company.update', 'Change the workspace profile and details'),
  ('company.delete', 'Archive or delete the workspace'),
  ('employees.read', 'See the workspace''s members'),
  ('employees.invite', 'Invite people to join'),
  ('employees.update', 'Change a member''s details, roles and teams'),
  ('employees.suspend', 'Suspend or reactivate a member'),
  ('employees.remove', 'Remove a member'),
  ('teams.read', 'See teams'),
  ('teams.create', 'Create teams'),
  ('teams.update', 'Change teams and their members'),
  ('teams.delete', 'Delete teams'),
  ('investigators.read', 'See the workspace''s investigator profiles'),
  ('investigators.create', 'Create investigator profiles'),
  ('investigators.update', 'Change investigator profiles'),
  ('investigators.delete', 'Remove investigator profiles'),
  ('investigators.assign', 'Put an investigator on an assignment'),
  ('investigations.read', 'See assignments one is staffed on, or one''s team is'),
  ('investigations.read_all', 'See every assignment in the workspace'),
  ('investigations.create', 'Quote on missions for the workspace'),
  ('investigations.update', 'Update assignments one can see'),
  ('investigations.assign', 'Staff assignments'),
  ('investigations.cancel', 'Cancel assignments'),
  ('reports.read', 'Read reports of assignments one can see'),
  ('evidence.read', 'Open evidence of assignments one can see'),
  ('reports.create', 'Write reports'),
  ('reports.update', 'Revise reports'),
  ('evidence.upload', 'Upload evidence'),
  ('knowledge.read', 'Search the workspace''s knowledge base'),
  ('knowledge.create', 'Add to the knowledge base'),
  ('knowledge.update', 'Change knowledge base documents'),
  ('knowledge.delete', 'Remove knowledge base documents'),
  ('leads.read', 'See every lead and its pre-hire conversation'),
  ('leads.route', 'Route leads to members and teams'),
  ('analytics.read', 'See the workspace''s reporting'),
  ('billing.read', 'See billing'),
  ('billing.manage', 'Change billing'),
  ('audit.read', 'Read the workspace''s audit log'),
  ('settings.read', 'See workspace settings'),
  ('settings.update', 'Change workspace settings');--> statement-breakpoint

INSERT INTO roles (key, name) VALUES
  ('OWNER', 'Owner'),
  ('ADMIN', 'Admin'),
  ('MANAGER', 'Manager'),
  ('INVESTIGATOR', 'Investigator'),
  ('AGENCY_STAFF', 'Staff'),
  ('VIEWER', 'Viewer');--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, v.permission_key
  FROM (VALUES
  ('OWNER', 'analytics.read'),
  ('OWNER', 'audit.read'),
  ('OWNER', 'billing.manage'),
  ('OWNER', 'billing.read'),
  ('OWNER', 'company.delete'),
  ('OWNER', 'company.read'),
  ('OWNER', 'company.update'),
  ('OWNER', 'employees.invite'),
  ('OWNER', 'employees.read'),
  ('OWNER', 'employees.remove'),
  ('OWNER', 'employees.suspend'),
  ('OWNER', 'employees.update'),
  ('OWNER', 'evidence.read'),
  ('OWNER', 'evidence.upload'),
  ('OWNER', 'investigations.assign'),
  ('OWNER', 'investigations.cancel'),
  ('OWNER', 'investigations.create'),
  ('OWNER', 'investigations.read'),
  ('OWNER', 'investigations.read_all'),
  ('OWNER', 'investigations.update'),
  ('OWNER', 'investigators.assign'),
  ('OWNER', 'investigators.create'),
  ('OWNER', 'investigators.delete'),
  ('OWNER', 'investigators.read'),
  ('OWNER', 'investigators.update'),
  ('OWNER', 'knowledge.create'),
  ('OWNER', 'knowledge.delete'),
  ('OWNER', 'knowledge.read'),
  ('OWNER', 'knowledge.update'),
  ('OWNER', 'leads.read'),
  ('OWNER', 'leads.route'),
  ('OWNER', 'reports.create'),
  ('OWNER', 'reports.read'),
  ('OWNER', 'reports.update'),
  ('OWNER', 'settings.read'),
  ('OWNER', 'settings.update'),
  ('OWNER', 'teams.create'),
  ('OWNER', 'teams.delete'),
  ('OWNER', 'teams.read'),
  ('OWNER', 'teams.update'),
  ('ADMIN', 'analytics.read'),
  ('ADMIN', 'audit.read'),
  ('ADMIN', 'billing.read'),
  ('ADMIN', 'company.read'),
  ('ADMIN', 'company.update'),
  ('ADMIN', 'employees.invite'),
  ('ADMIN', 'employees.read'),
  ('ADMIN', 'employees.remove'),
  ('ADMIN', 'employees.suspend'),
  ('ADMIN', 'employees.update'),
  ('ADMIN', 'evidence.read'),
  ('ADMIN', 'evidence.upload'),
  ('ADMIN', 'investigations.assign'),
  ('ADMIN', 'investigations.cancel'),
  ('ADMIN', 'investigations.create'),
  ('ADMIN', 'investigations.read'),
  ('ADMIN', 'investigations.read_all'),
  ('ADMIN', 'investigations.update'),
  ('ADMIN', 'investigators.assign'),
  ('ADMIN', 'investigators.create'),
  ('ADMIN', 'investigators.delete'),
  ('ADMIN', 'investigators.read'),
  ('ADMIN', 'investigators.update'),
  ('ADMIN', 'knowledge.create'),
  ('ADMIN', 'knowledge.delete'),
  ('ADMIN', 'knowledge.read'),
  ('ADMIN', 'knowledge.update'),
  ('ADMIN', 'leads.read'),
  ('ADMIN', 'leads.route'),
  ('ADMIN', 'reports.create'),
  ('ADMIN', 'reports.read'),
  ('ADMIN', 'reports.update'),
  ('ADMIN', 'settings.read'),
  ('ADMIN', 'settings.update'),
  ('ADMIN', 'teams.create'),
  ('ADMIN', 'teams.delete'),
  ('ADMIN', 'teams.read'),
  ('ADMIN', 'teams.update'),
  ('MANAGER', 'analytics.read'),
  ('MANAGER', 'company.read'),
  ('MANAGER', 'employees.read'),
  ('MANAGER', 'evidence.read'),
  ('MANAGER', 'evidence.upload'),
  ('MANAGER', 'investigations.assign'),
  ('MANAGER', 'investigations.cancel'),
  ('MANAGER', 'investigations.create'),
  ('MANAGER', 'investigations.read'),
  ('MANAGER', 'investigations.read_all'),
  ('MANAGER', 'investigations.update'),
  ('MANAGER', 'investigators.assign'),
  ('MANAGER', 'investigators.read'),
  ('MANAGER', 'knowledge.create'),
  ('MANAGER', 'knowledge.delete'),
  ('MANAGER', 'knowledge.read'),
  ('MANAGER', 'knowledge.update'),
  ('MANAGER', 'leads.read'),
  ('MANAGER', 'leads.route'),
  ('MANAGER', 'reports.create'),
  ('MANAGER', 'reports.read'),
  ('MANAGER', 'reports.update'),
  ('MANAGER', 'settings.read'),
  ('MANAGER', 'teams.create'),
  ('MANAGER', 'teams.delete'),
  ('MANAGER', 'teams.read'),
  ('MANAGER', 'teams.update'),
  ('INVESTIGATOR', 'company.read'),
  ('INVESTIGATOR', 'employees.read'),
  ('INVESTIGATOR', 'evidence.read'),
  ('INVESTIGATOR', 'evidence.upload'),
  ('INVESTIGATOR', 'investigations.create'),
  ('INVESTIGATOR', 'investigations.read'),
  ('INVESTIGATOR', 'investigations.update'),
  ('INVESTIGATOR', 'investigators.read'),
  ('INVESTIGATOR', 'knowledge.read'),
  ('INVESTIGATOR', 'reports.create'),
  ('INVESTIGATOR', 'reports.read'),
  ('INVESTIGATOR', 'reports.update'),
  ('INVESTIGATOR', 'teams.read'),
  ('AGENCY_STAFF', 'company.read'),
  ('AGENCY_STAFF', 'employees.read'),
  ('AGENCY_STAFF', 'evidence.read'),
  ('AGENCY_STAFF', 'investigations.read'),
  ('AGENCY_STAFF', 'investigators.read'),
  ('AGENCY_STAFF', 'knowledge.read'),
  ('AGENCY_STAFF', 'reports.read'),
  ('AGENCY_STAFF', 'teams.read'),
  ('VIEWER', 'company.read'),
  ('VIEWER', 'employees.read'),
  ('VIEWER', 'evidence.read'),
  ('VIEWER', 'investigations.read'),
  ('VIEWER', 'investigators.read'),
  ('VIEWER', 'knowledge.read'),
  ('VIEWER', 'reports.read'),
  ('VIEWER', 'teams.read')
  ) AS v(role_key, permission_key)
  JOIN roles r ON r.key = v.role_key AND r.tenant_id IS NULL;--> statement-breakpoint

-- Every user has a Personal workspace, made in the same statement as the user: registration,
-- Google sign-in (T-062), an admin tool and a test fixture all get one without remembering to.
CREATE FUNCTION create_personal_workspace() RETURNS trigger
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

CREATE TRIGGER users_create_personal_workspace
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_personal_workspace();--> statement-breakpoint

-- Backfill: every existing user gets what a new one now gets from the trigger, and existing
-- sessions default to it. Idempotent.
--
-- It runs BEFORE the owner-check triggers exist, then asserts the same invariant with one
-- set-based query. Created first, those row triggers would each lock and count once per
-- backfilled workspace at commit: over five minutes for the 40,815 users of the dev database,
-- holding locks throughout — too long for a production migration.
INSERT INTO tenants (kind, status, personal_owner_id)
SELECT 'PERSONAL', 'ACTIVE', u.id
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.personal_owner_id = u.id);--> statement-breakpoint
INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id, status)
SELECT t.id, 'PERSONAL', t.personal_owner_id, 'ACTIVE'
  FROM tenants t
 WHERE t.kind = 'PERSONAL'
   AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = t.id);--> statement-breakpoint
INSERT INTO membership_roles (membership_id, role_id)
SELECT m.id, r.id
  FROM tenant_memberships m
  JOIN roles r ON r.key = 'OWNER' AND r.tenant_id IS NULL
 WHERE m.tenant_kind = 'PERSONAL'
   AND NOT EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.membership_id = m.id);--> statement-breakpoint
UPDATE user_sessions s
   SET default_tenant_id = t.id
  FROM tenants t
 WHERE t.personal_owner_id = s.user_id
   AND s.default_tenant_id IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.personal_owner_id = u.id)
  ) OR EXISTS (
    SELECT 1 FROM tenants t
     WHERE t.status <> 'DELETED'
       AND NOT EXISTS (
         SELECT 1 FROM tenant_memberships m
           JOIN membership_roles mr ON mr.membership_id = m.id
           JOIN roles r ON r.id = mr.role_id AND r.key = 'OWNER' AND r.tenant_id IS NULL
          WHERE m.tenant_id = t.id AND m.status = 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'backfill incomplete: a user without a Personal workspace, or a workspace without an owner';
  END IF;
END $$;--> statement-breakpoint

-- Every workspace that is not DELETED has at least one ACTIVE member holding OWNER, checked at
-- commit — deferred, so ownership can move within one transaction (promote the new owner, then
-- demote the old). The workspace row is locked before counting: two transactions each removing
-- a different owner must not both see the other still there and leave nobody.
CREATE FUNCTION assert_tenant_has_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  workspace uuid;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    workspace := NEW.id;
  ELSIF TG_TABLE_NAME = 'tenant_memberships' THEN
    workspace := COALESCE(NEW.tenant_id, OLD.tenant_id);
  ELSE
    SELECT m.tenant_id INTO workspace FROM tenant_memberships m WHERE m.id = OLD.membership_id;
  END IF;

  -- Gone (a Personal workspace cascading with its user) or closed: nothing left to hold.
  PERFORM 1 FROM tenants t WHERE t.id = workspace AND t.status <> 'DELETED' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM tenant_memberships m
      JOIN membership_roles mr ON mr.membership_id = m.id
      JOIN roles r ON r.id = mr.role_id
     WHERE m.tenant_id = workspace
       AND m.status = 'ACTIVE'
       AND r.key = 'OWNER'
       AND r.tenant_id IS NULL
  ) THEN
    RAISE EXCEPTION 'tenant_has_active_owner: workspace % would have no active owner', workspace
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tenant_has_active_owner';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tenants_have_an_owner
  AFTER INSERT ON tenants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_tenant_has_owner();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tenant_memberships_keep_an_owner
  AFTER UPDATE OR DELETE ON tenant_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_tenant_has_owner();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER membership_roles_keep_an_owner
  AFTER UPDATE OR DELETE ON membership_roles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_tenant_has_owner();--> statement-breakpoint

-- A Personal workspace's one member is its owner — together with the partial unique index, it
-- can only ever contain the person it belongs to.
CREATE FUNCTION assert_personal_member_is_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.tenant_kind = 'PERSONAL' AND NEW.user_id IS DISTINCT FROM (
    SELECT t.personal_owner_id FROM tenants t WHERE t.id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'tenant_memberships_personal_is_owner: a Personal workspace can hold only the person it belongs to'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tenant_memberships_personal_is_owner';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER tenant_memberships_personal_is_owner
  BEFORE INSERT ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION assert_personal_member_is_owner();--> statement-breakpoint

-- What a workspace is, and who a membership is for, never change. A membership moved to another
-- person, or a Personal workspace handed to someone else, would carry every grant along with it.
CREATE FUNCTION forbid_identity_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.personal_owner_id IS DISTINCT FROM OLD.personal_owner_id THEN
      RAISE EXCEPTION 'tenants_identity_immutable: a workspace''s kind and owner never change'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tenants_identity_immutable';
    END IF;
  ELSIF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.tenant_kind IS DISTINCT FROM OLD.tenant_kind
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'tenant_memberships_identity_immutable: a membership''s workspace and person never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tenant_memberships_identity_immutable';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER tenants_identity_immutable
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();--> statement-breakpoint
CREATE TRIGGER tenant_memberships_identity_immutable
  BEFORE UPDATE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();--> statement-breakpoint

-- Workspaces and memberships: no DELETE. A workspace is archived or deleted through its
-- lifecycle (T-090); a member is REMOVED, and the row keeps the attribution.
GRANT SELECT, INSERT, UPDATE ON tenants TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON tenants FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_memberships TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON tenant_memberships FROM investigator_app;--> statement-breakpoint

-- Role assignments are added and taken away, never edited in place.
GRANT SELECT, INSERT, DELETE ON membership_roles TO investigator_app;--> statement-breakpoint
REVOKE UPDATE ON membership_roles FROM investigator_app;--> statement-breakpoint

-- The catalog is data the migration owns. Custom roles (later) get their own grants and RLS.
GRANT SELECT ON permissions, roles, role_permissions TO investigator_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON permissions, roles, role_permissions FROM investigator_app;
