-- Reverse of 0012. db-migration requires every migration to have a working down path.
DROP TRIGGER IF EXISTS customer_profiles_fill_tenant ON customer_profiles;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_profiles_fill_tenant ON investigator_profiles;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_assets_fill_tenant ON media_assets;--> statement-breakpoint
DROP TRIGGER IF EXISTS idempotency_keys_fill_tenant ON idempotency_keys;--> statement-breakpoint
DROP TRIGGER IF EXISTS missions_fill_tenant ON missions;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_languages_fill_from_profile ON investigator_languages;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_specialties_fill_from_profile ON investigator_specialties;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_availability_fill_from_profile ON investigator_availability;--> statement-breakpoint
DROP TRIGGER IF EXISTS service_areas_fill_from_profile ON service_areas;--> statement-breakpoint
DROP TRIGGER IF EXISTS verification_requests_fill_from_profile ON verification_requests;--> statement-breakpoint
DROP TRIGGER IF EXISTS verification_request_documents_fill_from_request ON verification_request_documents;--> statement-breakpoint
DROP TRIGGER IF EXISTS verification_decisions_fill_from_request ON verification_decisions;--> statement-breakpoint
DROP TRIGGER IF EXISTS mission_status_history_fill_from_mission ON mission_status_history;--> statement-breakpoint
DROP TRIGGER IF EXISTS mission_screenings_fill_from_mission ON mission_screenings;--> statement-breakpoint
DROP TRIGGER IF EXISTS quotes_fill_from_mission ON quotes;--> statement-breakpoint
DROP TRIGGER IF EXISTS quotes_fill_from_profile ON quotes;--> statement-breakpoint
DROP TRIGGER IF EXISTS assignments_fill_from_quote ON assignments;--> statement-breakpoint
DROP TRIGGER IF EXISTS assignment_status_history_fill_from_assignment ON assignment_status_history;--> statement-breakpoint
DROP TRIGGER IF EXISTS assignment_status_history_tenant_immutable ON assignment_status_history;--> statement-breakpoint
DROP TRIGGER IF EXISTS assignments_tenant_immutable ON assignments;--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_profiles_tenant_immutable ON customer_profiles;--> statement-breakpoint
DROP TRIGGER IF EXISTS idempotency_keys_tenant_immutable ON idempotency_keys;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_availability_tenant_immutable ON investigator_availability;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_languages_tenant_immutable ON investigator_languages;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_profiles_tenant_immutable ON investigator_profiles;--> statement-breakpoint
DROP TRIGGER IF EXISTS investigator_specialties_tenant_immutable ON investigator_specialties;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_assets_tenant_immutable ON media_assets;--> statement-breakpoint
DROP TRIGGER IF EXISTS mission_screenings_tenant_immutable ON mission_screenings;--> statement-breakpoint
DROP TRIGGER IF EXISTS mission_status_history_tenant_immutable ON mission_status_history;--> statement-breakpoint
DROP TRIGGER IF EXISTS missions_tenant_immutable ON missions;--> statement-breakpoint
DROP TRIGGER IF EXISTS quotes_tenant_immutable ON quotes;--> statement-breakpoint
DROP TRIGGER IF EXISTS service_areas_tenant_immutable ON service_areas;--> statement-breakpoint
DROP TRIGGER IF EXISTS verification_decisions_tenant_immutable ON verification_decisions;--> statement-breakpoint
DROP TRIGGER IF EXISTS verification_request_documents_tenant_immutable ON verification_request_documents;--> statement-breakpoint
DROP TRIGGER IF EXISTS verification_requests_tenant_immutable ON verification_requests;--> statement-breakpoint
DROP FUNCTION IF EXISTS fill_owner_tenant();--> statement-breakpoint
DROP FUNCTION IF EXISTS fill_party_from_parent();--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_tenant_change();--> statement-breakpoint
ALTER TABLE "assignment_status_history" DROP CONSTRAINT IF EXISTS "assignment_history_parties_fk";--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT IF EXISTS "assignments_quote_parties_fk";--> statement-breakpoint
ALTER TABLE "idempotency_keys" DROP CONSTRAINT IF EXISTS "idempotency_keys_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_mission_customer_tenant_fk";--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_profile_supplier_tenant_fk";--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT IF EXISTS "media_assets_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "mission_screenings" DROP CONSTRAINT IF EXISTS "mission_screenings_mission_tenant_fk";--> statement-breakpoint
ALTER TABLE "mission_status_history" DROP CONSTRAINT IF EXISTS "mission_status_history_mission_tenant_fk";--> statement-breakpoint
ALTER TABLE "missions" DROP CONSTRAINT IF EXISTS "missions_customer_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP CONSTRAINT IF EXISTS "customer_profiles_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "investigator_availability" DROP CONSTRAINT IF EXISTS "investigator_availability_profile_tenant_fk";--> statement-breakpoint
ALTER TABLE "investigator_languages" DROP CONSTRAINT IF EXISTS "investigator_languages_profile_tenant_fk";--> statement-breakpoint
ALTER TABLE "investigator_profiles" DROP CONSTRAINT IF EXISTS "investigator_profiles_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "investigator_specialties" DROP CONSTRAINT IF EXISTS "investigator_specialties_profile_tenant_fk";--> statement-breakpoint
ALTER TABLE "service_areas" DROP CONSTRAINT IF EXISTS "service_areas_profile_tenant_fk";--> statement-breakpoint
ALTER TABLE "verification_decisions" DROP CONSTRAINT IF EXISTS "verification_decisions_request_tenant_fk";--> statement-breakpoint
ALTER TABLE "verification_request_documents" DROP CONSTRAINT IF EXISTS "verification_documents_request_tenant_fk";--> statement-breakpoint
ALTER TABLE "verification_request_documents" DROP CONSTRAINT IF EXISTS "verification_documents_asset_tenant_fk";--> statement-breakpoint
ALTER TABLE "verification_requests" DROP CONSTRAINT IF EXISTS "verification_requests_profile_tenant_fk";--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT IF EXISTS "assignments_id_parties_unique";--> statement-breakpoint
ALTER TABLE "idempotency_keys" DROP CONSTRAINT IF EXISTS "idempotency_keys_scope_unique";--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_id_parties_unique";--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT IF EXISTS "media_assets_id_tenant_unique";--> statement-breakpoint
ALTER TABLE "missions" DROP CONSTRAINT IF EXISTS "missions_id_customer_tenant_unique";--> statement-breakpoint
ALTER TABLE "investigator_profiles" DROP CONSTRAINT IF EXISTS "investigator_profiles_id_tenant_unique";--> statement-breakpoint
ALTER TABLE "verification_requests" DROP CONSTRAINT IF EXISTS "verification_requests_id_tenant_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "assignments_customer_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "assignments_supplier_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "quotes_supplier_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "quotes_customer_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "media_assets_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "missions_customer_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "customer_profiles_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "investigator_profiles_tenant_user_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "investigator_profiles_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "service_areas_tenant_idx";--> statement-breakpoint
ALTER TABLE "assignment_status_history" DROP COLUMN IF EXISTS "customer_tenant_id";--> statement-breakpoint
ALTER TABLE "assignment_status_history" DROP COLUMN IF EXISTS "supplier_tenant_id";--> statement-breakpoint
ALTER TABLE "assignments" DROP COLUMN IF EXISTS "customer_tenant_id";--> statement-breakpoint
ALTER TABLE "assignments" DROP COLUMN IF EXISTS "supplier_tenant_id";--> statement-breakpoint
ALTER TABLE "idempotency_keys" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN IF EXISTS "customer_tenant_id";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN IF EXISTS "supplier_tenant_id";--> statement-breakpoint
ALTER TABLE "media_assets" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "mission_screenings" DROP COLUMN IF EXISTS "customer_tenant_id";--> statement-breakpoint
ALTER TABLE "mission_status_history" DROP COLUMN IF EXISTS "customer_tenant_id";--> statement-breakpoint
ALTER TABLE "missions" DROP COLUMN IF EXISTS "customer_tenant_id";--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "investigator_availability" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "investigator_languages" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "investigator_profiles" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "investigator_specialties" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "service_areas" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "verification_decisions" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "verification_request_documents" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
ALTER TABLE "verification_requests" DROP COLUMN IF EXISTS "tenant_id";--> statement-breakpoint
DROP FUNCTION IF EXISTS app_tenant_for_user(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS app_current_tenant();--> statement-breakpoint
-- The uniques 0012 replaced.
CREATE UNIQUE INDEX "investigator_profiles_user_unique" ON "investigator_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_unique" ON "idempotency_keys" USING btree ("actor_id","endpoint","key");
