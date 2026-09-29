-- T-082: jobs carry and restore their workspace (tenancy.md §9).
--
-- outbox_events learns who produced each event — workspace, user, membership — from the context by
-- DEFAULT, and joins row-level security: a producer may write only as itself in its own workspace,
-- and only the dispatcher, in the system context, reads and marks rows. Events written before this
-- migration, and events the system itself produces, have no producer workspace (NULL): their work
-- runs as the system.
--
-- job_runs records what a job did in a workspace, keyed within it, so a retry or a duplicate
-- delivery finds its work already done — tenant_owned. job_dead_letters keeps a job that failed for
-- good, with the context it was queued in, for the system context alone — system class.

CREATE TABLE "job_dead_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"queue" text NOT NULL,
	"command" text NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"membership_id" uuid,
	"payload" jsonb NOT NULL,
	"error" text NOT NULL,
	"attempts" integer NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant(),
	"job_key" text NOT NULL,
	"command" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_runs_tenant_key_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","job_key")
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "tenant_id" uuid DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "user_id" uuid DEFAULT app_current_user();--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "membership_id" uuid DEFAULT app_current_membership();--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_dead_letters_failed_idx" ON "job_dead_letters" USING btree ("failed_at");
--> statement-breakpoint

-- ── outbox_events ─────────────────────────────────────────────────────────────────────────────
-- The grant is unchanged (SELECT, INSERT, UPDATE since 0007); what changes is who each row admits.
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Written as the producer, all three ids from the context: a row naming another member — even of
-- the same workspace — would later run that member's work with their authority.
CREATE POLICY producer_insert ON outbox_events FOR INSERT
  WITH CHECK (
    (tenant_id = app_current_tenant()
      AND user_id = app_current_user()
      AND membership_id = app_current_membership())
    OR app_platform_access()
  );--> statement-breakpoint
CREATE POLICY dispatcher_read ON outbox_events FOR SELECT USING (app_platform_access());--> statement-breakpoint
CREATE POLICY dispatcher_mark ON outbox_events FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint

-- ── job_runs ──────────────────────────────────────────────────────────────────────────────────
-- Recorded once and never edited: an idempotency key that could be changed is no longer one.
-- The application holds no UPDATE on it; the move guard says so in the database as well.
CREATE TRIGGER job_runs_tenant_immutable BEFORE UPDATE OF tenant_id ON job_runs
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
REVOKE ALL ON job_runs FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT ON job_runs TO investigator_app;--> statement-breakpoint
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON job_runs FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint

-- ── job_dead_letters ──────────────────────────────────────────────────────────────────────────
REVOKE ALL ON job_dead_letters FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT ON job_dead_letters TO investigator_app;--> statement-breakpoint
ALTER TABLE job_dead_letters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE job_dead_letters FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_only ON job_dead_letters FOR ALL
  USING (app_platform_access()) WITH CHECK (app_platform_access());
