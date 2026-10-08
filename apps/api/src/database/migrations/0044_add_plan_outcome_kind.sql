-- T-226: a plan's outcome as a message kind of its own. Its own migration because PostgreSQL will not
-- use an enum value in the transaction that added it; 0045 uses it.
ALTER TYPE "public"."ai_message_kind" ADD VALUE 'PLAN_OUTCOME';
