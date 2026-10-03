-- Mission tags (T-055): a curated vocabulary on top of the taxonomy. Staff maintain the tags;
-- customers suggest them on a draft, moderators confirm them when publishing; browse filters and
-- orders by confirmed tags and nothing else reads them. A tag never decides who sees a mission.

CREATE TYPE "public"."tag_status" AS ENUM('ACTIVE', 'DEPRECATED');--> statement-breakpoint
CREATE TABLE "mission_tags" (
	"mission_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"suggested_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	CONSTRAINT "mission_tags_mission_id_tag_id_pk" PRIMARY KEY("mission_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag_labels" (
	"tag_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_labels_tag_id_locale_pk" PRIMARY KEY("tag_id","locale")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"status" "tag_status" DEFAULT 'ACTIVE' NOT NULL,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_tags" ADD CONSTRAINT "mission_tags_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_tags" ADD CONSTRAINT "mission_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_tags" ADD CONSTRAINT "mission_tags_mission_tenant_fk" FOREIGN KEY ("mission_id","customer_tenant_id") REFERENCES "public"."missions"("id","customer_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_labels" ADD CONSTRAINT "tag_labels_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_merged_into_id_tags_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_tags_tenant_mission_idx" ON "mission_tags" USING btree ("customer_tenant_id","mission_id");--> statement-breakpoint
CREATE INDEX "mission_tags_tag_idx" ON "mission_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_unique" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tags_merged_into_idx" ON "tags" USING btree ("merged_into_id");--> statement-breakpoint

-- ── tags: the vocabulary ───────────────────────────────────────────────────────────────────────
ALTER TABLE "tags"
  ADD CONSTRAINT "tags_slug_shape" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 60),
  -- A merged tag is retired, and never merged into itself.
  ADD CONSTRAINT "tags_merged_is_deprecated" CHECK ("merged_into_id" IS NULL OR "status" = 'DEPRECATED'),
  ADD CONSTRAINT "tags_not_merged_into_self" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");--> statement-breakpoint
ALTER TABLE "tag_labels"
  ADD CONSTRAINT "tag_labels_locale_known" CHECK ("locale" IN ('en', 'ru', 'hy')),
  ADD CONSTRAINT "tag_labels_label_length" CHECK (length(btrim("label")) BETWEEN 1 AND 60);--> statement-breakpoint

-- A tag keeps its slug for good, is merged once, into a tag still in use, and a merged tag stays
-- retired: the missions that carried it are found through the merge, which must not move.
CREATE FUNCTION keep_tag_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'tag_slug_fixed: a tag keeps its slug for good' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.merged_into_id IS NOT NULL
     AND (NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id OR NEW.status <> 'DEPRECATED') THEN
    RAISE EXCEPTION 'tag_merged_once: a merged tag stays merged, into the same tag'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.merged_into_id IS NOT NULL AND NEW.merged_into_id IS DISTINCT FROM
       (CASE WHEN TG_OP = 'UPDATE' THEN OLD.merged_into_id END)
     AND NOT EXISTS (SELECT 1 FROM tags WHERE id = NEW.merged_into_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'tag_merge_target_active: a tag is merged into one still in use'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER tags_identity_kept BEFORE INSERT OR UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION keep_tag_identity();--> statement-breakpoint

-- ── mission_tags: suggested by the customer, confirmed by a moderator ──────────────────────────
ALTER TABLE "mission_tags"
  ADD CONSTRAINT "mission_tags_suggested_or_confirmed" CHECK ("suggested_at" IS NOT NULL OR "confirmed_at" IS NOT NULL),
  ADD CONSTRAINT "mission_tags_confirmed_in_full" CHECK (("confirmed_at" IS NULL) = ("confirmed_by" IS NULL));--> statement-breakpoint
CREATE TRIGGER mission_tags_fill_from_mission BEFORE INSERT ON mission_tags
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('missions', 'mission_id', 'customer_tenant_id:customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER mission_tags_tenant_immutable BEFORE UPDATE OF customer_tenant_id ON mission_tags
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id');--> statement-breakpoint

-- ── grants: the REVOKEs do the work ─────────────────────────────────────────────────────────────
-- tags and tag_labels are read by everyone and written by staff; nothing deletes either.
REVOKE ALL ON tags FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON tag_labels FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON mission_tags FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tags TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tag_labels TO investigator_app;--> statement-breakpoint
-- DELETE: a customer withdraws a suggestion from their own draft; the policy narrows it to that.
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_tags TO investigator_app;--> statement-breakpoint

-- ── row-level security ──────────────────────────────────────────────────────────────────────────
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tags FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY everyone_reads ON tags FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY staff_insert ON tags FOR INSERT WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY staff_update ON tags FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint

ALTER TABLE tag_labels ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tag_labels FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY everyone_reads ON tag_labels FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY staff_insert ON tag_labels FOR INSERT WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY staff_update ON tag_labels FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint

-- The customer's workspace reads its missions' tags, and suggests or withdraws one only while the
-- mission is a draft and the tag is unconfirmed. Staff confirm, inside PlatformContext. Anyone
-- else reads a confirmed tag only on a mission they can already see — the subquery runs under the
-- reader's own policies on missions, which never read mission_tags back.
ALTER TABLE mission_tags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mission_tags FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY reads ON mission_tags FOR SELECT
  USING (customer_tenant_id = app_current_tenant() OR app_platform_access()
         OR (confirmed_at IS NOT NULL AND app_current_tenant() IS NOT NULL
             AND EXISTS (SELECT 1 FROM missions m WHERE m.id = mission_tags.mission_id)));--> statement-breakpoint
CREATE POLICY customer_suggests ON mission_tags FOR INSERT
  WITH CHECK (app_platform_access()
              OR (customer_tenant_id = app_current_tenant() AND confirmed_at IS NULL
                  AND EXISTS (SELECT 1 FROM missions m
                               WHERE m.id = mission_tags.mission_id AND m.status = 'DRAFT')));--> statement-breakpoint
CREATE POLICY customer_withdraws ON mission_tags FOR DELETE
  USING (app_platform_access()
         OR (customer_tenant_id = app_current_tenant() AND confirmed_at IS NULL
             AND EXISTS (SELECT 1 FROM missions m
                          WHERE m.id = mission_tags.mission_id AND m.status = 'DRAFT')));--> statement-breakpoint
CREATE POLICY staff_confirms ON mission_tags FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());
