-- T-045: assistant sessions and their messages (ADR-0006). Approved 2026-09-23: a session is
-- readable by its own user in its own workspace and nobody else; deleting one erases its content
-- in the same transaction and keeps a tombstone.

CREATE TYPE "public"."ai_message_kind" AS ENUM('TEXT', 'TOOL_CALL', 'TOOL_RESULT');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"kind" "ai_message_kind" DEFAULT 'TEXT' NOT NULL,
	"content" text,
	"event" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	"content_search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED,
	CONSTRAINT "ai_messages_session_sequence_unique" UNIQUE("session_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	"title" text,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title_search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", ''))) STORED
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_messages_content_search_idx" ON "ai_messages" USING gin ("content_search");--> statement-breakpoint
CREATE INDEX "ai_sessions_owner_recent_idx" ON "ai_sessions" USING btree ("tenant_id","user_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "ai_sessions_title_search_idx" ON "ai_sessions" USING gin ("title_search");--> statement-breakpoint

ALTER TABLE "ai_sessions"
  ADD CONSTRAINT "ai_sessions_title_length" CHECK ("title" IS NULL OR length(btrim("title")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "ai_sessions_next_sequence_positive" CHECK ("next_sequence" >= 1),
  -- A tombstone keeps who and when, and nothing that could say what the conversation was about.
  ADD CONSTRAINT "ai_sessions_deleted_is_blank" CHECK ("deleted_at" IS NULL OR "title" IS NULL),
  ADD CONSTRAINT "ai_sessions_id_owner_unique" UNIQUE ("id", "tenant_id", "user_id");--> statement-breakpoint

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_sequence_positive" CHECK ("sequence" >= 1),
  -- Tool calls and results are structured events, never prose (ADR-0006). Every JSON test is
  -- coalesced to false: a CHECK *passes* on NULL, and without it a tool call with no event at all
  -- made the expression NULL and went through — which the spec caught (T-045).
  ADD CONSTRAINT "ai_messages_shape" CHECK (
    ("kind" = 'TEXT' AND "content" IS NOT NULL AND "event" IS NULL)
    OR ("kind" = 'TOOL_CALL' AND "role" = 'ASSISTANT'
        AND coalesce(jsonb_typeof("event" -> 'tool') = 'string', false)
        AND coalesce("event" ? 'arguments', false))
    OR ("kind" = 'TOOL_RESULT' AND "role" = 'TOOL'
        AND coalesce(jsonb_typeof("event" -> 'tool') = 'string', false)
        AND coalesce(jsonb_typeof("event" -> 'resultId') = 'string', false))
  ),
  -- The message's owner is its session's owner: never a message readable where its session is not.
  ADD CONSTRAINT "ai_messages_session_owner_fk" FOREIGN KEY ("session_id", "tenant_id", "user_id")
    REFERENCES "public"."ai_sessions" ("id", "tenant_id", "user_id") ON DELETE restrict;--> statement-breakpoint

-- Owner copied from the session, and never changed, on both tables (T-076).
CREATE TRIGGER ai_messages_fill_from_session BEFORE INSERT ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('ai_sessions', 'session_id', 'tenant_id:tenant_id', 'user_id:user_id');--> statement-breakpoint
CREATE TRIGGER ai_sessions_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON ai_sessions
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint
-- Redundant with append-only below, and kept: every scoped table carries this guard by name, so
-- the rule does not depend on remembering why one table was different (table-classes.spec).
CREATE TRIGGER ai_messages_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint

-- Append-only: the history is the source record every summary is built from (ADR-0006).
CREATE FUNCTION forbid_ai_message_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'an assistant message is never rewritten' USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER ai_messages_append_only BEFORE UPDATE ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_ai_message_change();--> statement-breakpoint

-- A deleted session is a tombstone, and stays an empty one.
CREATE FUNCTION keep_deleted_session_empty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_sessions WHERE id = NEW.session_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a deleted session takes no messages' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ai_messages_not_into_deleted BEFORE INSERT ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION keep_deleted_session_empty();--> statement-breakpoint

-- The REVOKEs do the work (migration 0000's default privileges grant everything). Sessions are
-- never deleted — a tombstone stays. Messages are never updated, and are deleted only with their
-- session.
REVOKE ALL ON ai_sessions FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON ai_messages FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ai_sessions TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON ai_messages TO investigator_app;--> statement-breakpoint

-- One user, one workspace. Not even an agency's owner reads a colleague's conversation.
ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_conversation ON ai_sessions FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_conversation ON ai_messages FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());
