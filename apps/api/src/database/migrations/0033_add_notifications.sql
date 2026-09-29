-- T-036: notifications — the in-app centre and per-channel preferences (plan.md §13).
--
-- Both tables are tenant-owned and **private to their person** within the workspace, like
-- ai_sessions (0019): an agency's other members cannot read a colleague's notifications or
-- preferences. Rows are written by the delivery job in the recipient's own restored context
-- (T-082), so every id defaults from it. A notification holds references only — kind, subject,
-- link — never the content it is about.

CREATE TABLE "notification_preferences" (
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid DEFAULT app_current_user() NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_tenant_id_user_id_category_channel_pk" PRIMARY KEY("tenant_id","user_id","category","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"recipient_id" uuid DEFAULT app_current_user() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"href" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_recipient_unique" ON "notifications" USING btree ("tenant_id","event_id","recipient_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("tenant_id","recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint

ALTER TABLE notifications
  ADD CONSTRAINT notifications_href_relative CHECK (href ~ '^/[^/\\]'),
  ADD CONSTRAINT notifications_kind_format CHECK (kind ~ '^[a-z_]+$');--> statement-breakpoint
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_channel CHECK (channel IN ('email')),
  ADD CONSTRAINT notification_preferences_category CHECK (category IN ('activity'));--> statement-breakpoint

CREATE TRIGGER notifications_tenant_immutable BEFORE UPDATE OF tenant_id, recipient_id, event_id
  ON notifications FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'recipient_id', 'event_id');--> statement-breakpoint
CREATE TRIGGER notification_preferences_tenant_immutable BEFORE UPDATE OF tenant_id, user_id
  ON notification_preferences FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'user_id');--> statement-breakpoint

-- Marked read, never deleted by the application: retention removes them (retention.md).
REVOKE ALL ON notifications FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notifications TO investigator_app;--> statement-breakpoint
REVOKE ALL ON notification_preferences FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO investigator_app;--> statement-breakpoint

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_notifications ON notifications FOR ALL
  USING ((tenant_id = app_current_tenant() AND recipient_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND recipient_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_preferences ON notification_preferences FOR ALL
  USING ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((tenant_id = app_current_tenant() AND user_id = app_current_user()) OR app_platform_access());
