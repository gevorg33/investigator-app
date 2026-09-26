-- T-084: an agency's public profile, its settings, and its logo and cover.
--
-- `tenant_profiles` — the public projection of an agency (tenancy.md §12). Its own workspace reads
-- and writes it; anyone signed in reads it once it is published. Only agencies have one: the
-- composite key to `tenants (id, kind)` with `tenant_kind` held to AGENCY.
--
-- `tenant_settings` — one row per saved section, a section with no row being its defaults. Private
-- to the workspace. Which sections exist, and that a value is an object, are held here; each
-- section's shape is the API's.
--
-- `AGENCY_LOGO`, `AGENCY_COVER` — media that belong to an agency. The new values are not named in
-- any policy or CHECK below: a value added to an enum cannot be used in the transaction that adds
-- it. The category rule is a trigger, whose body is read when it runs.

ALTER TYPE "public"."media_category" ADD VALUE 'AGENCY_LOGO';--> statement-breakpoint
ALTER TYPE "public"."media_category" ADD VALUE 'AGENCY_COVER';--> statement-breakpoint
CREATE TABLE "tenant_profiles" (
	"tenant_id" uuid PRIMARY KEY DEFAULT app_current_tenant() NOT NULL,
	"tenant_kind" "tenant_kind" DEFAULT 'AGENCY' NOT NULL,
	"display_name" text,
	"headline" text,
	"about" text,
	"logo_media_id" uuid,
	"cover_media_id" uuid,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"section" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_pk" PRIMARY KEY("tenant_id","section")
);
--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_tenant_kind_fk" FOREIGN KEY ("tenant_id","tenant_kind") REFERENCES "public"."tenants"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_logo_fk" FOREIGN KEY ("logo_media_id","tenant_id") REFERENCES "public"."media_assets"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_cover_fk" FOREIGN KEY ("cover_media_id","tenant_id") REFERENCES "public"."media_assets"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- ── tenant_profiles ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "tenant_profiles"
  ADD CONSTRAINT "tenant_profiles_agency_only" CHECK ("tenant_kind" = 'AGENCY'),
  ADD CONSTRAINT "tenant_profiles_text_lengths" CHECK (
    ("display_name" IS NULL OR length(btrim("display_name")) BETWEEN 2 AND 120)
    AND ("headline" IS NULL OR length(btrim("headline")) BETWEEN 1 AND 160)
    AND ("about" IS NULL OR length(btrim("about")) BETWEEN 1 AND 3000)),
  ADD CONSTRAINT "tenant_profiles_version_positive" CHECK ("version" >= 1),
  -- What customers find says what the agency does: no published profile without a headline.
  ADD CONSTRAINT "tenant_profiles_published_has_headline" CHECK ("published_at" IS NULL OR "headline" IS NOT NULL);--> statement-breakpoint

-- The logo is an AGENCY_LOGO and the cover an AGENCY_COVER, whoever writes the row. The composite
-- keys already hold that each is this agency's own file.
CREATE FUNCTION assert_tenant_profile_media() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.logo_media_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM media_assets m WHERE m.id = NEW.logo_media_id AND m.category::text = 'AGENCY_LOGO'
  ) THEN
    RAISE EXCEPTION 'tenant_profiles_logo_category: the logo must be an AGENCY_LOGO'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tenant_profiles_logo_category';
  END IF;
  IF NEW.cover_media_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM media_assets m WHERE m.id = NEW.cover_media_id AND m.category::text = 'AGENCY_COVER'
  ) THEN
    RAISE EXCEPTION 'tenant_profiles_cover_category: the cover must be an AGENCY_COVER'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tenant_profiles_cover_category';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER tenant_profiles_media BEFORE INSERT OR UPDATE OF logo_media_id, cover_media_id
  ON tenant_profiles FOR EACH ROW EXECUTE FUNCTION assert_tenant_profile_media();--> statement-breakpoint
CREATE TRIGGER tenant_profiles_tenant_immutable BEFORE UPDATE OF tenant_id ON tenant_profiles
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint

-- Created, edited, published and unpublished; never deleted — unpublishing is how one goes.
REVOKE ALL ON tenant_profiles FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_profiles TO investigator_app;--> statement-breakpoint
ALTER TABLE tenant_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenant_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON tenant_profiles FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
-- As a published investigator profile (0013): anyone signed in, in some workspace, may read it.
CREATE POLICY public_read ON tenant_profiles FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND published_at IS NOT NULL);--> statement-breakpoint

-- ── tenants: the agency behind a published profile ──────────────────────────────────────────────
-- Its registered name, country and status are part of what the projection shows or depends on.
-- The row is readable; the service selects only those columns. tenant_profiles' policies never
-- join back to tenants.
CREATE POLICY public_read ON tenants FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND kind = 'AGENCY' AND EXISTS (
    SELECT 1 FROM tenant_profiles p WHERE p.tenant_id = tenants.id AND p.published_at IS NOT NULL));--> statement-breakpoint

-- ── media_assets: a published agency's logo and cover ───────────────────────────────────────────
-- The link media.md waited for: an image is shown to others through the published profile that
-- names it, and a draft profile's images stay as invisible as the draft.
CREATE POLICY public_branding_read ON media_assets FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM tenant_profiles p
     WHERE p.tenant_id = media_assets.tenant_id AND p.published_at IS NOT NULL
       AND (p.logo_media_id = media_assets.id OR p.cover_media_id = media_assets.id)));--> statement-breakpoint

-- ── tenant_settings ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_known_section" CHECK ("section" IN (
    'general', 'branding', 'localisation', 'notifications', 'ai', 'investigations', 'employees',
    'security', 'privacy', 'integrations', 'billing')),
  ADD CONSTRAINT "tenant_settings_value_object" CHECK (jsonb_typeof("value") = 'object'),
  ADD CONSTRAINT "tenant_settings_version_positive" CHECK ("version" >= 1);--> statement-breakpoint
CREATE TRIGGER tenant_settings_tenant_immutable BEFORE UPDATE OF tenant_id, section ON tenant_settings
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id', 'section');--> statement-breakpoint
-- Saved and changed; never deleted — a section goes back to its defaults by saving them.
REVOKE ALL ON tenant_settings FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_settings TO investigator_app;--> statement-breakpoint
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_rw ON tenant_settings FOR ALL
  USING (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());
