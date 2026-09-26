-- T-085: employees — invitations, and the membership's own details and lifecycle.
--
-- `tenant_invitations` — an address, the one role it grants, a hashed single-use token. Its
-- workspace reads and writes it. The invitee reads their own pending invitation, joins with it and
-- marks it accepted through policies keyed on their account's confirmed email — never on anything
-- a request says. EXPIRED is a PENDING invitation past `expires_at`, derived when read.
--
-- `tenant_memberships` — job title, department, and locale and time zone overrides. Name, email
-- and avatar stay the user's. A removed member rejoins by accepting a new invitation, which
-- brings the same row back to ACTIVE (one membership per person per workspace).
--
-- `membership_roles` — a workspace may now assign roles to its own members; until now only the
-- creator's OWNER role could be written, at creation. Which roles a member may grant is the API's
-- rule on permissions (no granting upward); the last-owner invariant stays the database's.
--
-- `ai_sessions` — when a membership leaves ACTIVE, that person's sessions in that workspace are
-- archived, whoever made the change (owner decision, 2026-09-27). Sessions are private to their
-- owner, so this is the third function allowed to raise platform access, beside the two tenancy
-- integrity checks; `rls.spec.ts` lists all three.
CREATE TYPE "public"."invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "tenant_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"tenant_kind" "tenant_kind" DEFAULT 'AGENCY' NOT NULL,
	"email" "citext" NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_by" uuid,
	"sent_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_fk" FOREIGN KEY ("tenant_id","tenant_kind") REFERENCES "public"."tenants"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invitations_token_hash_unique" ON "tenant_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invitations_one_pending" ON "tenant_invitations" USING btree ("tenant_id","email") WHERE "tenant_invitations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "tenant_invitations_tenant_idx" ON "tenant_invitations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "tenant_invitations_invitee_idx" ON "tenant_invitations" USING btree ("email") WHERE "tenant_invitations"."status" = 'PENDING';--> statement-breakpoint
-- ── The account's confirmed address, for the invitee's policies ─────────────────────────────────
-- `users` has no row-level security (identity, tenancy.md §7), so this reads no policy and none
-- reaches back. An unconfirmed account has no address here, and so no invitation.
CREATE FUNCTION app_current_confirmed_email() RETURNS citext
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT u.email FROM users u
   WHERE u.id = app_current_user() AND u.email_verified_at IS NOT NULL AND u.status = 'ACTIVE'
$$;--> statement-breakpoint
-- ── tenant_memberships: the employee's own details ──────────────────────────────────────────────
ALTER TABLE "tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_employee_text" CHECK (
    ("job_title" IS NULL OR length(btrim("job_title")) BETWEEN 1 AND 120)
    AND ("department" IS NULL OR length(btrim("department")) BETWEEN 1 AND 120)),
  ADD CONSTRAINT "tenant_memberships_locale_known" CHECK ("locale" IS NULL OR "locale" IN ('en', 'ru', 'hy')),
  -- An IANA name; which ones exist is the API's check (as users.timezone).
  ADD CONSTRAINT "tenant_memberships_timezone_length" CHECK ("timezone" IS NULL OR length("timezone") BETWEEN 1 AND 64);--> statement-breakpoint
-- ── tenant_invitations ──────────────────────────────────────────────────────────────────────────
ALTER TABLE "tenant_invitations"
  ADD CONSTRAINT "tenant_invitations_agency_only" CHECK ("tenant_kind" = 'AGENCY'),
  ADD CONSTRAINT "tenant_invitations_sent" CHECK ("sent_count" >= 1),
  ADD CONSTRAINT "tenant_invitations_accepted_complete" CHECK (
    ("status" = 'ACCEPTED') = ("accepted_by" IS NOT NULL AND "accepted_at" IS NOT NULL)),
  ADD CONSTRAINT "tenant_invitations_cancelled_complete" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));--> statement-breakpoint
-- An invitation is for one address, one role, one workspace: to change any, cancel and invite again.
CREATE TRIGGER tenant_invitations_identity_immutable BEFORE UPDATE OF tenant_id, email, role_id
  ON tenant_invitations FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'email', 'role_id');--> statement-breakpoint
-- Created, resent, cancelled or accepted; never deleted — the row is the record of who was asked.
REVOKE ALL ON tenant_invitations FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_invitations TO investigator_app;--> statement-breakpoint
ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenant_invitations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON tenant_invitations FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
-- The invitee sees their own pending invitations, and one they accepted themselves — nothing
-- cancelled, and nothing someone else used. (An UPDATE's new row must also pass the SELECT
-- policies, so without the second half accepting would refuse itself.)
CREATE POLICY invitee_read ON tenant_invitations FOR SELECT
  USING (email = app_current_confirmed_email()
         AND (status = 'PENDING' OR (status = 'ACCEPTED' AND accepted_by = app_current_user())));--> statement-breakpoint
-- …and may mark one accepted, by themselves, while it is live — and do nothing else to it.
CREATE POLICY invitee_accept ON tenant_invitations FOR UPDATE
  USING (status = 'PENDING' AND expires_at > now() AND email = app_current_confirmed_email())
  WITH CHECK (status = 'ACCEPTED' AND accepted_by = app_current_user()
              AND email = app_current_confirmed_email());--> statement-breakpoint
-- ── tenant_memberships: joining by invitation ───────────────────────────────────────────────────
-- A person may create their own ACTIVE membership in an agency that has a live invitation for
-- their confirmed address. Nothing else lets anyone join an agency they did not create.
CREATE POLICY invited_insert ON tenant_memberships FOR INSERT
  WITH CHECK (tenant_kind = 'AGENCY' AND user_id = app_current_user() AND status = 'ACTIVE'
    AND EXISTS (SELECT 1 FROM tenant_invitations i
                 WHERE i.tenant_id = tenant_memberships.tenant_id AND i.status = 'PENDING'
                   AND i.expires_at > now() AND i.email = app_current_confirmed_email()));--> statement-breakpoint
-- …or bring their own REMOVED membership back the same way. Never a SUSPENDED one: suspension is
-- the agency's decision to reverse, not the member's.
CREATE POLICY invited_rejoin ON tenant_memberships FOR UPDATE
  USING (tenant_kind = 'AGENCY' AND user_id = app_current_user() AND status = 'REMOVED'
    AND EXISTS (SELECT 1 FROM tenant_invitations i
                 WHERE i.tenant_id = tenant_memberships.tenant_id AND i.status = 'PENDING'
                   AND i.expires_at > now() AND i.email = app_current_confirmed_email()))
  WITH CHECK (user_id = app_current_user() AND status = 'ACTIVE');--> statement-breakpoint
-- ── membership_roles ────────────────────────────────────────────────────────────────────────────
-- A workspace assigns roles to its own agency members — a system role, or (later) one of its own.
CREATE POLICY workspace_insert ON membership_roles FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_memberships m
                       WHERE m.id = membership_roles.membership_id
                         AND m.tenant_id = app_current_tenant() AND m.tenant_kind = 'AGENCY')
    AND EXISTS (SELECT 1 FROM roles r
                 WHERE r.id = membership_roles.role_id
                   AND (r.tenant_id IS NULL OR r.tenant_id = app_current_tenant())));--> statement-breakpoint
-- The invitee takes the invitation's role — that one, and only while the invitation is live.
CREATE POLICY invited_role_insert ON membership_roles FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_memberships m
                       WHERE m.id = membership_roles.membership_id
                         AND m.user_id = app_current_user() AND m.tenant_kind = 'AGENCY'
                         AND EXISTS (SELECT 1 FROM tenant_invitations i
                                      WHERE i.tenant_id = m.tenant_id AND i.status = 'PENDING'
                                        AND i.expires_at > now()
                                        AND i.role_id = membership_roles.role_id
                                        AND i.email = app_current_confirmed_email())));--> statement-breakpoint
-- ── ai_sessions: a departing member's conversations close ───────────────────────────────────────
CREATE FUNCTION archive_departed_member_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET app.platform_access = 'on' AS $$
BEGIN
  -- Only that person, only in that workspace; a session already archived or deleted is left be.
  UPDATE ai_sessions
     SET archived_at = now(), updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND archived_at IS NULL AND deleted_at IS NULL;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER tenant_memberships_archive_sessions AFTER UPDATE OF status ON tenant_memberships
  FOR EACH ROW WHEN (OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE')
  EXECUTE FUNCTION archive_departed_member_sessions()