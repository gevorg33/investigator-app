-- Reverses 0024_add_agency_profiles. Dropping a table drops its triggers and policies with it.
-- AGENCY_LOGO and AGENCY_COVER stay in media_category: PostgreSQL cannot remove an enum value, and
-- once the tables are gone nothing can use them.
DROP POLICY IF EXISTS public_branding_read ON media_assets;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON tenants;--> statement-breakpoint
DROP TABLE IF EXISTS tenant_settings;--> statement-breakpoint
DROP TABLE IF EXISTS tenant_profiles;--> statement-breakpoint
DROP FUNCTION IF EXISTS assert_tenant_profile_media();
