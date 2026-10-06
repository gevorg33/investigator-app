-- Reverses 0045_record_plan_outcomes: plans stop telling their outcome, the messages that did are
-- erased, and the shape that refuses them is restored. The plans and their steps keep the outcome.
DROP TRIGGER IF EXISTS ai_plans_outcome ON ai_plans;
DROP FUNCTION IF EXISTS record_ai_plan_outcome();
DELETE FROM ai_messages WHERE kind = 'PLAN_OUTCOME';
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
  );
