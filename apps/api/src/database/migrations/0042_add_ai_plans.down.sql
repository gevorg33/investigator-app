-- Reverses 0042_add_ai_plans. Restores the departure trigger to archiving sessions alone, then drops
-- the tables, which takes their triggers and policies with them. Destructive once a plan or a stored
-- result exists: run it only where none does (db-migration).
CREATE OR REPLACE FUNCTION archive_departed_member_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET app.platform_access = 'on' AS $$
BEGIN
  -- Only that person, only in that workspace; a session already archived or deleted is left be.
  UPDATE ai_sessions
     SET archived_at = now(), updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND archived_at IS NULL AND deleted_at IS NULL;
  RETURN NULL;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS ai_plan_steps;--> statement-breakpoint
DROP TABLE IF EXISTS ai_plans;--> statement-breakpoint
DROP TABLE IF EXISTS ai_tool_results;--> statement-breakpoint
DROP FUNCTION IF EXISTS check_ai_plan_change();--> statement-breakpoint
DROP FUNCTION IF EXISTS check_ai_plan_step_change();--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_ai_tool_result_change();--> statement-breakpoint
DROP TYPE IF EXISTS ai_plan_step_status;--> statement-breakpoint
DROP TYPE IF EXISTS ai_plan_status;--> statement-breakpoint
DROP TYPE IF EXISTS ai_confirmation_status;
