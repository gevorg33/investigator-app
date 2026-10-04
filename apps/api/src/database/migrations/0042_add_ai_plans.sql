-- T-048: plans the assistant proposes, their steps, and tool results too large for a prompt
-- (ADR-0006, ADR-0012). Approved 2026-10-05 as the confirmation gate. Each is private as its session
-- — its own user in its own workspace — and erased with it. A plan's steps are fixed when proposed,
-- so the hash a person confirms is over exactly what runs; only progress changes afterwards. A
-- member who leaves a workspace has their open plans there voided, beside their sessions archived.

CREATE TYPE "public"."ai_confirmation_status" AS ENUM('PENDING', 'CONFIRMED', 'DECLINED', 'INVALIDATED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."ai_plan_status" AS ENUM('PROPOSED', 'CONFIRMED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ai_plan_step_status" AS ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "ai_plan_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"tool" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"observed" text NOT NULL,
	"status" "ai_plan_step_status" DEFAULT 'PENDING' NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	CONSTRAINT "ai_plan_steps_plan_ordinal_unique" UNIQUE("plan_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "ai_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	"session_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"status" "ai_plan_status" DEFAULT 'PROPOSED' NOT NULL,
	"confirmation_status" "ai_confirmation_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_role" "user_role_name",
	"reason" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"summary" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_plan_steps" ADD CONSTRAINT "ai_plan_steps_plan_id_ai_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."ai_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_plan_steps" ADD CONSTRAINT "ai_plan_steps_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_results" ADD CONSTRAINT "ai_tool_results_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_plans_session_idx" ON "ai_plans" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_plans_owner_open_idx" ON "ai_plans" USING btree ("tenant_id","user_id") WHERE "ai_plans"."status" IN ('PROPOSED', 'CONFIRMED');--> statement-breakpoint
CREATE INDEX "ai_tool_results_session_idx" ON "ai_tool_results" USING btree ("session_id");--> statement-breakpoint

-- ── shape ───────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ai_plans"
  ADD CONSTRAINT "ai_plans_hash_format" CHECK ("plan_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ai_plans_reason_code" CHECK ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,64}$'),
  -- The plan's progress and its confirmation move together: nothing runs unconfirmed, and a plan
  -- that did not run says why.
  ADD CONSTRAINT "ai_plans_status_pairs" CHECK (
    ("status" = 'PROPOSED' AND "confirmation_status" = 'PENDING')
    OR ("status" IN ('CONFIRMED', 'EXECUTING', 'COMPLETED', 'FAILED')
        AND "confirmation_status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "confirmation_status" IN ('DECLINED', 'INVALIDATED', 'VOIDED'))
  ),
  ADD CONSTRAINT "ai_plans_finished" CHECK (
    ("finished_at" IS NOT NULL) = ("status" IN ('COMPLETED', 'FAILED', 'CANCELLED'))
  ),
  ADD CONSTRAINT "ai_plans_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "ai_plans_id_owner_unique" UNIQUE ("id", "session_id", "tenant_id", "user_id"),
  -- The plan's owner is its session's: never a plan readable where its session is not.
  ADD CONSTRAINT "ai_plans_session_owner_fk" FOREIGN KEY ("session_id", "tenant_id", "user_id")
    REFERENCES "public"."ai_sessions" ("id", "tenant_id", "user_id") ON DELETE restrict;--> statement-breakpoint

ALTER TABLE "ai_plan_steps"
  -- Ten commands at most: a plan is something a person reads before confirming (bulk is T-095).
  ADD CONSTRAINT "ai_plan_steps_ordinal_range" CHECK ("ordinal" BETWEEN 1 AND 10),
  ADD CONSTRAINT "ai_plan_steps_tool_name" CHECK ("tool" ~ '^[a-z][A-Za-z]{1,63}$'),
  ADD CONSTRAINT "ai_plan_steps_arguments_object" CHECK (jsonb_typeof("arguments") = 'object'),
  ADD CONSTRAINT "ai_plan_steps_observed_format" CHECK ("observed" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ai_plan_steps_error_code" CHECK ("error" IS NULL OR "error" ~ '^[a-z_]{1,64}$'),
  ADD CONSTRAINT "ai_plan_steps_progress" CHECK (
    ("status" = 'PENDING' AND "started_at" IS NULL AND "finished_at" IS NULL)
    OR ("status" = 'RUNNING' AND "started_at" IS NOT NULL AND "finished_at" IS NULL)
    OR ("status" = 'DONE' AND "finished_at" IS NOT NULL AND "error" IS NULL)
    OR ("status" = 'FAILED' AND "finished_at" IS NOT NULL AND "error" IS NOT NULL)
    OR ("status" = 'SKIPPED' AND "finished_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "ai_plan_steps_plan_owner_fk" FOREIGN KEY ("plan_id", "session_id", "tenant_id", "user_id")
    REFERENCES "public"."ai_plans" ("id", "session_id", "tenant_id", "user_id") ON DELETE restrict;--> statement-breakpoint

ALTER TABLE "ai_tool_results"
  ADD CONSTRAINT "ai_tool_results_tool_name" CHECK ("tool" ~ '^[a-z][A-Za-z]{1,63}$'),
  ADD CONSTRAINT "ai_tool_results_items_array" CHECK (jsonb_typeof("items") = 'array'),
  ADD CONSTRAINT "ai_tool_results_summary_object" CHECK (jsonb_typeof("summary") = 'object'),
  ADD CONSTRAINT "ai_tool_results_total" CHECK ("total" = jsonb_array_length("items")),
  ADD CONSTRAINT "ai_tool_results_session_owner_fk" FOREIGN KEY ("session_id", "tenant_id", "user_id")
    REFERENCES "public"."ai_sessions" ("id", "tenant_id", "user_id") ON DELETE restrict;--> statement-breakpoint

-- ── owners, copied and never changed (T-076) ────────────────────────────────────────────────────
CREATE TRIGGER ai_plans_fill_from_session BEFORE INSERT ON ai_plans
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('ai_sessions', 'session_id', 'tenant_id:tenant_id', 'user_id:user_id');--> statement-breakpoint
CREATE TRIGGER ai_plan_steps_fill_from_plan BEFORE INSERT ON ai_plan_steps
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('ai_plans', 'plan_id', 'session_id:session_id', 'tenant_id:tenant_id', 'user_id:user_id');--> statement-breakpoint
CREATE TRIGGER ai_tool_results_fill_from_session BEFORE INSERT ON ai_tool_results
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('ai_sessions', 'session_id', 'tenant_id:tenant_id', 'user_id:user_id');--> statement-breakpoint
CREATE TRIGGER ai_plans_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON ai_plans
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER ai_plan_steps_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON ai_plan_steps
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER ai_tool_results_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON ai_tool_results
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint

-- ── kept, whoever the writer is ─────────────────────────────────────────────────────────────────
-- What a person confirms is the hash, so nothing the hash covers may change after it is taken; and a
-- plan only moves forward. A confirmation is given once: CONFIRMED is reached only from PENDING, and
-- left only for INVALIDATED (a re-check found a change) or VOIDED (its owner left the workspace).
CREATE FUNCTION check_ai_plan_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'confirmation_status', 'confirmed_at', 'confirmed_role', 'reason', 'finished_at', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'confirmation_status', 'confirmed_at', 'confirmed_role', 'reason', 'finished_at', 'updated_at']) THEN
    RAISE EXCEPTION 'ai_plan_fixed: a plan is not rewritten after it is proposed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_plan_fixed';
  END IF;
  IF NEW.confirmation_status IS DISTINCT FROM OLD.confirmation_status AND NOT (
       OLD.confirmation_status = 'PENDING'
       OR (OLD.confirmation_status = 'CONFIRMED' AND NEW.confirmation_status IN ('INVALIDATED', 'VOIDED'))
     ) THEN
    RAISE EXCEPTION 'ai_plan_confirmation_once: % cannot become %', OLD.confirmation_status, NEW.confirmation_status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_plan_confirmation_once';
  END IF;
  IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'ai_plan_confirmation_once: a confirmation keeps its time'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_plan_confirmation_once';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PROPOSED' AND NEW.status IN ('CONFIRMED', 'CANCELLED'))
       OR (OLD.status = 'CONFIRMED' AND NEW.status IN ('EXECUTING', 'CANCELLED'))
       OR (OLD.status = 'EXECUTING' AND NEW.status IN ('COMPLETED', 'FAILED', 'CANCELLED'))
     ) THEN
    RAISE EXCEPTION 'ai_plan_forward: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_plan_forward';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ai_plans_change BEFORE UPDATE ON ai_plans
  FOR EACH ROW EXECUTE FUNCTION check_ai_plan_change();--> statement-breakpoint

-- A step's definition is part of the hash; only its progress is written after it is proposed, and
-- a finished step stays finished.
CREATE FUNCTION check_ai_plan_step_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'result', 'error', 'started_at', 'finished_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'result', 'error', 'started_at', 'finished_at']) THEN
    RAISE EXCEPTION 'ai_plan_step_fixed: a step is not rewritten after it is proposed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_plan_step_fixed';
  END IF;
  IF OLD.status IN ('DONE', 'FAILED', 'SKIPPED') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'ai_plan_step_finished: a finished step stays as it finished'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_plan_step_finished';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ai_plan_steps_change BEFORE UPDATE ON ai_plan_steps
  FOR EACH ROW EXECUTE FUNCTION check_ai_plan_step_change();--> statement-breakpoint

-- A stored result is what the tool returned; it is read in pages and never edited.
CREATE FUNCTION forbid_ai_tool_result_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'ai_tool_result_fixed: a stored tool result is never rewritten'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_tool_result_fixed';
END $$;--> statement-breakpoint
CREATE TRIGGER ai_tool_results_append_only BEFORE UPDATE ON ai_tool_results
  FOR EACH ROW EXECUTE FUNCTION forbid_ai_tool_result_change();--> statement-breakpoint

-- Nothing is added to a deleted session's tombstone (as ai_messages, 0019).
CREATE TRIGGER ai_plans_not_into_deleted BEFORE INSERT ON ai_plans
  FOR EACH ROW EXECUTE FUNCTION keep_deleted_session_empty();--> statement-breakpoint
CREATE TRIGGER ai_tool_results_not_into_deleted BEFORE INSERT ON ai_tool_results
  FOR EACH ROW EXECUTE FUNCTION keep_deleted_session_empty();--> statement-breakpoint

-- ── a departing member's open plans are voided (T-085, owner decision 2026-09-27) ──────────────
-- The same function that archives their sessions, so it stays the one function of its kind that
-- raises platform access (rls.spec.ts). Only plans that have not started: one already executing
-- runs on a job whose context the runner re-reads, and a removed member's is refused.
CREATE OR REPLACE FUNCTION archive_departed_member_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET app.platform_access = 'on' AS $$
BEGIN
  -- Only that person, only in that workspace; a session already archived or deleted is left be.
  UPDATE ai_sessions
     SET archived_at = now(), updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND archived_at IS NULL AND deleted_at IS NULL;
  UPDATE ai_plans
     SET status = 'CANCELLED', confirmation_status = 'VOIDED', reason = 'member_left',
         finished_at = now(), updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND status IN ('PROPOSED', 'CONFIRMED');
  RETURN NULL;
END $$;--> statement-breakpoint

-- ── grants: deleted only with their session (SESSION_CONTENT); results never updated ───────────
REVOKE ALL ON ai_plans FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON ai_plan_steps FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON ai_tool_results FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_plans TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_plan_steps TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON ai_tool_results TO investigator_app;--> statement-breakpoint

-- ── one user, one workspace, as their session ───────────────────────────────────────────────────
ALTER TABLE ai_plans ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_plans FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_conversation ON ai_plans FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
ALTER TABLE ai_plan_steps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_plan_steps FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_conversation ON ai_plan_steps FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
ALTER TABLE ai_tool_results ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_tool_results FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_conversation ON ai_tool_results FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());
