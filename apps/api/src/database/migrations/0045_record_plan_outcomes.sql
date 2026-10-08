-- T-226 (P-15): every plan that ends says how, in its conversation, in the transaction that ends it.
--
-- A plan is ended by several writers — the worker, the dead-letter hook, a person's confirm or decline,
-- and the departing-member function (0043), which is SQL. Whichever it is, the plan's session gets one
-- PLAN_OUTCOME message, built here from the step rows and never from a model: which steps were done,
-- which failed and with what code, which never ran, and which were left running and may have taken
-- effect. The status moves forward only and ends once (check_ai_plan_change), so it is written once; a
-- worker that dies before its commit takes the message with the status, and the run that ends the
-- plan writes it.
--
-- Widening ai_messages_shape is approved for this task (2026-10-07): the three existing shapes are
-- unchanged, and PLAN_OUTCOME is a system event with no words of its own — the reader's catalog
-- renders it.

ALTER TABLE "ai_messages"
  DROP CONSTRAINT "ai_messages_shape",
  ADD CONSTRAINT "ai_messages_shape" CHECK (
    ("kind" = 'TEXT' AND "content" IS NOT NULL AND "event" IS NULL)
    OR ("kind" = 'TOOL_CALL' AND "role" = 'ASSISTANT'
        AND coalesce(jsonb_typeof("event" -> 'tool') = 'string', false)
        AND coalesce("event" ? 'arguments', false))
    OR ("kind" = 'TOOL_RESULT' AND "role" = 'TOOL'
        AND coalesce(jsonb_typeof("event" -> 'tool') = 'string', false)
        AND coalesce(jsonb_typeof("event" -> 'resultId') = 'string', false))
    -- As text: migrations run in one transaction, and PostgreSQL will not use 0044's new value in it.
    OR ("kind"::text = 'PLAN_OUTCOME' AND "role" = 'SYSTEM' AND "content" IS NULL
        AND coalesce(jsonb_typeof("event" -> 'planId') = 'string', false)
        AND coalesce("event" ->> 'outcome' IN ('completed', 'partial', 'failed', 'not_run', 'declined'), false)
        AND coalesce(jsonb_typeof("event" -> 'steps') = 'array', false))
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_messages" VALIDATE CONSTRAINT "ai_messages_shape";--> statement-breakpoint

-- The outcome is read from the steps, never from the status alone, so a plan that stopped part-way is
-- never told as done:
--   completed  COMPLETED, and every step DONE
--   partial    otherwise, some step DONE — or left RUNNING, which may have taken effect
--   failed     FAILED, and nothing took effect
--   declined   its person said no
--   not_run    voided or invalidated before anything ran
-- A step still PENDING when its plan ends never will run: it is told as SKIPPED, whichever order the
-- writer marks it in (0043 ends the plan first, then skips its steps).
CREATE FUNCTION record_ai_plan_outcome() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  steps jsonb;
  outcome text;
  seq integer;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ordinal', s.ordinal,
           'tool', s.tool,
           'status', CASE WHEN s.status = 'PENDING' THEN 'SKIPPED' ELSE s.status::text END,
           'error', s.error) ORDER BY s.ordinal), '[]'::jsonb)
    INTO steps
    FROM ai_plan_steps s
   WHERE s.plan_id = NEW.id;

  outcome := CASE
    WHEN NEW.status = 'COMPLETED'
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(steps) e WHERE e ->> 'status' <> 'DONE')
      THEN 'completed'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(steps) e WHERE e ->> 'status' IN ('DONE', 'RUNNING'))
      THEN 'partial'
    WHEN NEW.status = 'FAILED' THEN 'failed'
    WHEN NEW.confirmation_status = 'DECLINED' THEN 'declined'
    ELSE 'not_run'
  END;

  -- The session row is the lock its sequence is taken under, as AiSessionsService.append takes it. The
  -- session stays as it is otherwise: an outcome is not the person's activity, and an archived
  -- conversation is not brought back by one.
  UPDATE ai_sessions
     SET next_sequence = next_sequence + 1, updated_at = now()
   WHERE id = NEW.session_id
  RETURNING next_sequence - 1 INTO seq;
  IF seq IS NULL THEN
    RAISE EXCEPTION 'ai_plan_outcome_told: plan %''s session is not visible to its writer', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_plan_outcome_told';
  END IF;

  INSERT INTO ai_messages (session_id, sequence, role, kind, event)
  VALUES (NEW.session_id, seq, 'SYSTEM', 'PLAN_OUTCOME', jsonb_build_object(
    'planId', NEW.id,
    'outcome', outcome,
    'status', NEW.status,
    'confirmation', NEW.confirmation_status,
    'reason', NEW.reason,
    'steps', steps));
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER ai_plans_outcome AFTER UPDATE OF status ON ai_plans
  FOR EACH ROW
  WHEN (NEW.status IN ('COMPLETED', 'FAILED', 'CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION record_ai_plan_outcome();
