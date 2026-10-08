-- T-046: what the Context Builder keeps beside a conversation (ADR-0006). Summaries of spans of it
-- — versioned, with the model, instructions and sequence range that made each, and written once —
-- and structured session state: the entities it is about, as columns. Both private as their
-- session (its own user in its own workspace) and erased with it (SESSION_CONTENT). Neither is the
-- record: the messages are, and the database is for what is true now.

CREATE TABLE "ai_session_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"status" text,
	"last_mentioned_sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	CONSTRAINT "ai_session_entities_ref_unique" UNIQUE("session_id","kind","entity_id")
);
--> statement-breakpoint
CREATE TABLE "ai_session_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"level" integer NOT NULL,
	"source_sequence_start" integer NOT NULL,
	"source_sequence_end" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	CONSTRAINT "ai_session_summaries_version_unique" UNIQUE("session_id","version")
);
--> statement-breakpoint
ALTER TABLE "ai_session_entities" ADD CONSTRAINT "ai_session_entities_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_session_summaries" ADD CONSTRAINT "ai_session_summaries_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_session_summaries_span_idx" ON "ai_session_summaries" USING btree ("session_id","level","source_sequence_end");--> statement-breakpoint

ALTER TABLE "ai_session_summaries"
  ADD CONSTRAINT "ai_session_summaries_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "ai_session_summaries_level_range" CHECK ("level" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ai_session_summaries_range" CHECK ("source_sequence_start" >= 1 AND "source_sequence_end" >= "source_sequence_start"),
  ADD CONSTRAINT "ai_session_summaries_model" CHECK (length(btrim("model")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "ai_session_summaries_prompt_version" CHECK ("prompt_version" ~ '^[a-z][a-z0-9-]{1,63}$'),
  ADD CONSTRAINT "ai_session_summaries_content_shape" CHECK (
    jsonb_typeof("content") = 'object'
    AND COALESCE(jsonb_typeof("content" -> 'entities') = 'array', false)
    AND COALESCE(jsonb_typeof("content" -> 'decisions') = 'array', false)
    AND COALESCE(jsonb_typeof("content" -> 'constraints') = 'array', false)
    AND COALESCE(jsonb_typeof("content" -> 'completed') = 'array', false)
    AND COALESCE(jsonb_typeof("content" -> 'pending') = 'array', false)
  ),
  ADD CONSTRAINT "ai_session_summaries_session_owner_fk" FOREIGN KEY ("session_id", "tenant_id", "user_id")
    REFERENCES "public"."ai_sessions" ("id", "tenant_id", "user_id") ON DELETE restrict;--> statement-breakpoint

ALTER TABLE "ai_session_entities"
  ADD CONSTRAINT "ai_session_entities_kind" CHECK ("kind" IN ('mission', 'assignment', 'quote', 'investigator_profile', 'plan', 'team', 'invitation')),
  ADD CONSTRAINT "ai_session_entities_origin" CHECK ("origin" IN ('user', 'shown', 'result', 'plan')),
  -- An enum value as last seen, never prose: a sentence here would be a summary by another name.
  ADD CONSTRAINT "ai_session_entities_status_code" CHECK ("status" IS NULL OR "status" ~ '^[A-Z][A-Z_]{0,39}$'),
  ADD CONSTRAINT "ai_session_entities_sequence_positive" CHECK ("last_mentioned_sequence" >= 1),
  ADD CONSTRAINT "ai_session_entities_session_owner_fk" FOREIGN KEY ("session_id", "tenant_id", "user_id")
    REFERENCES "public"."ai_sessions" ("id", "tenant_id", "user_id") ON DELETE restrict;--> statement-breakpoint

-- ── owners, copied and never changed (T-076) ────────────────────────────────────────────────────
CREATE TRIGGER ai_session_summaries_fill_from_session BEFORE INSERT ON ai_session_summaries
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('ai_sessions', 'session_id', 'tenant_id:tenant_id', 'user_id:user_id');--> statement-breakpoint
CREATE TRIGGER ai_session_entities_fill_from_session BEFORE INSERT ON ai_session_entities
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('ai_sessions', 'session_id', 'tenant_id:tenant_id', 'user_id:user_id');--> statement-breakpoint
CREATE TRIGGER ai_session_summaries_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON ai_session_summaries
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER ai_session_entities_tenant_immutable BEFORE UPDATE OF tenant_id, user_id ON ai_session_entities
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint

-- ── a summary is what was written from its span, and is never rewritten ─────────────────────────
CREATE FUNCTION forbid_ai_session_summary_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'ai_session_summary_fixed: a summary is never rewritten; a new version is written'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'ai_session_summary_fixed';
END $$;--> statement-breakpoint
CREATE TRIGGER ai_session_summaries_append_only BEFORE UPDATE ON ai_session_summaries
  FOR EACH ROW EXECUTE FUNCTION forbid_ai_session_summary_change();--> statement-breakpoint

-- Nothing is added to a deleted session's tombstone (as ai_messages, 0019).
CREATE TRIGGER ai_session_summaries_not_into_deleted BEFORE INSERT ON ai_session_summaries
  FOR EACH ROW EXECUTE FUNCTION keep_deleted_session_empty();--> statement-breakpoint
CREATE TRIGGER ai_session_entities_not_into_deleted BEFORE INSERT ON ai_session_entities
  FOR EACH ROW EXECUTE FUNCTION keep_deleted_session_empty();--> statement-breakpoint

-- ── grants: deleted only with their session (SESSION_CONTENT); summaries never updated ─────────
REVOKE ALL ON ai_session_summaries FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON ai_session_entities FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON ai_session_summaries TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_session_entities TO investigator_app;--> statement-breakpoint

-- ── one user, one workspace, as their session ───────────────────────────────────────────────────
ALTER TABLE ai_session_summaries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_session_summaries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_conversation ON ai_session_summaries FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
ALTER TABLE ai_session_entities ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_session_entities FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_conversation ON ai_session_entities FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());
