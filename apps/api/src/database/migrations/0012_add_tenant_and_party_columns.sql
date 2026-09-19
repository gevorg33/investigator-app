-- T-076: tenant and party columns on every workspace-scoped table (ADR-0011, tenancy.md §7).
-- Hand-ordered, because the generated order cannot run on existing rows: columns are added
-- nullable, backfilled, asserted, and only then made NOT NULL; the unique constraints that the
-- composite foreign keys point at are created before those keys.
--
-- Owner decisions (2026-09-19):
--   * values come from the execution context, else from the row's own data: owner columns from the
--     owning user's Personal workspace, party columns ALWAYS from the parent row;
--   * consistency is declarative: composite foreign keys hold every copied party equal to its
--     parent, and a trigger refuses any change to a tenant or party column after insert.
--
-- One deliberate exception: idempotency_keys.tenant_id is NULL for a system action. Assignment
-- creation from a payment runs as a system actor with no workspace (found by this migration's own
-- backfill assertion), and its key belongs to no workspace rather than an invented one.
-- The workspace of the current transaction, or NULL outside one. NULLIF because a setting reads
-- back as '' once the transaction that set it has ended, and ''::uuid throws (T-073, verified).
CREATE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint
-- The workspace a row a user owns belongs to: the context's, else the user's Personal workspace,
-- else none (an actor who is not a user: the system). One definition, used by the fill trigger and
-- by the idempotency lookups, so writing and reading a key can never disagree about its workspace.
CREATE FUNCTION app_tenant_for_user(owner_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(app_current_tenant(), (SELECT t.id FROM tenants t WHERE t.personal_owner_id = owner_id))
$$;--> statement-breakpoint
ALTER TABLE "assignment_status_history" ADD COLUMN "customer_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_status_history" ADD COLUMN "supplier_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "customer_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "supplier_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "customer_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "supplier_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_screenings" ADD COLUMN "customer_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_status_history" ADD COLUMN "customer_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "customer_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "investigator_availability" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "investigator_languages" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "investigator_profiles" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "investigator_specialties" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_decisions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_request_documents" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint

-- Backfill (tenancy.md §5). Owners first, from each owning user's Personal workspace; then every
-- copied party from its parent, in dependency order.
UPDATE "customer_profiles" x SET "tenant_id" = w.id FROM tenants w WHERE w.personal_owner_id = x."user_id";--> statement-breakpoint
UPDATE "investigator_profiles" x SET "tenant_id" = w.id FROM tenants w WHERE w.personal_owner_id = x."user_id";--> statement-breakpoint
UPDATE "media_assets" x SET "tenant_id" = w.id FROM tenants w WHERE w.personal_owner_id = x."owner_id";--> statement-breakpoint
UPDATE "idempotency_keys" x SET "tenant_id" = w.id FROM tenants w WHERE w.personal_owner_id = x."actor_id";--> statement-breakpoint
UPDATE "missions" x SET "customer_tenant_id" = w.id FROM tenants w WHERE w.personal_owner_id = x."customer_id";--> statement-breakpoint
UPDATE "investigator_languages" x SET "tenant_id" = p."tenant_id" FROM "investigator_profiles" p WHERE p.id = x."profile_id";--> statement-breakpoint
UPDATE "investigator_specialties" x SET "tenant_id" = p."tenant_id" FROM "investigator_profiles" p WHERE p.id = x."profile_id";--> statement-breakpoint
UPDATE "investigator_availability" x SET "tenant_id" = p."tenant_id" FROM "investigator_profiles" p WHERE p.id = x."profile_id";--> statement-breakpoint
UPDATE "service_areas" x SET "tenant_id" = p."tenant_id" FROM "investigator_profiles" p WHERE p.id = x."profile_id";--> statement-breakpoint
UPDATE "verification_requests" x SET "tenant_id" = p."tenant_id" FROM "investigator_profiles" p WHERE p.id = x."profile_id";--> statement-breakpoint
UPDATE "verification_request_documents" x SET "tenant_id" = p."tenant_id" FROM "verification_requests" p WHERE p.id = x."request_id";--> statement-breakpoint
UPDATE "verification_decisions" x SET "tenant_id" = p."tenant_id" FROM "verification_requests" p WHERE p.id = x."request_id";--> statement-breakpoint
UPDATE "mission_status_history" x SET "customer_tenant_id" = p."customer_tenant_id" FROM "missions" p WHERE p.id = x."mission_id";--> statement-breakpoint
UPDATE "mission_screenings" x SET "customer_tenant_id" = p."customer_tenant_id" FROM "missions" p WHERE p.id = x."mission_id";--> statement-breakpoint
UPDATE "quotes" x SET "customer_tenant_id" = p."customer_tenant_id" FROM "missions" p WHERE p.id = x."mission_id";--> statement-breakpoint
UPDATE "quotes" x SET "supplier_tenant_id" = p."tenant_id" FROM "investigator_profiles" p WHERE p.id = x."investigator_profile_id";--> statement-breakpoint
UPDATE "assignments" x SET "customer_tenant_id" = p."customer_tenant_id", "supplier_tenant_id" = p."supplier_tenant_id" FROM "quotes" p WHERE p.id = x."quote_id";--> statement-breakpoint
UPDATE "assignment_status_history" x SET "customer_tenant_id" = p."customer_tenant_id", "supplier_tenant_id" = p."supplier_tenant_id" FROM "assignments" p WHERE p.id = x."assignment_id";--> statement-breakpoint
-- The migration asserts its own backfill: not one row left without a workspace, and an
-- idempotency key without one only where its actor is not a user.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "assignment_status_history" WHERE "customer_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "assignment_status_history" WHERE "supplier_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "assignments" WHERE "customer_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "assignments" WHERE "supplier_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "quotes" WHERE "customer_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "quotes" WHERE "supplier_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "media_assets" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "mission_screenings" WHERE "customer_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "mission_status_history" WHERE "customer_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "missions" WHERE "customer_tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "customer_profiles" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "investigator_availability" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "investigator_languages" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "investigator_profiles" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "investigator_specialties" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "service_areas" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "verification_decisions" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "verification_request_documents" WHERE "tenant_id" IS NULL) OR EXISTS (SELECT 1 FROM "verification_requests" WHERE "tenant_id" IS NULL) THEN
    RAISE EXCEPTION 'backfill incomplete: a row has no workspace';
  END IF;
  IF EXISTS (
    SELECT 1 FROM idempotency_keys k
     WHERE k.tenant_id IS NULL
       AND EXISTS (SELECT 1 FROM tenants t WHERE t.personal_owner_id = k.actor_id)
  ) THEN
    RAISE EXCEPTION 'backfill incomplete: a user''s idempotency key has no workspace';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "assignment_status_history" ALTER COLUMN "customer_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "assignment_status_history" ALTER COLUMN "customer_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_status_history" ALTER COLUMN "supplier_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "assignment_status_history" ALTER COLUMN "supplier_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "customer_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "customer_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "supplier_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "supplier_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "customer_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "customer_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "supplier_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "supplier_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_screenings" ALTER COLUMN "customer_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "mission_screenings" ALTER COLUMN "customer_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_status_history" ALTER COLUMN "customer_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "mission_status_history" ALTER COLUMN "customer_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "missions" ALTER COLUMN "customer_tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "missions" ALTER COLUMN "customer_tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "customer_profiles" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "investigator_availability" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "investigator_availability" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "investigator_languages" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "investigator_languages" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "investigator_profiles" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "investigator_profiles" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "investigator_specialties" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "investigator_specialties" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "service_areas" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "service_areas" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_decisions" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "verification_decisions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_request_documents" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "verification_request_documents" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_requests" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "verification_requests" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

-- Constraints: the old uniques go, the parents' (id, party) uniques come before the keys that use them.
DROP INDEX "idempotency_keys_scope_unique";--> statement-breakpoint
DROP INDEX "investigator_profiles_user_unique";--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_id_parties_unique" UNIQUE("id","customer_tenant_id","supplier_tenant_id");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_scope_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","actor_id","endpoint","key");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_id_parties_unique" UNIQUE("id","customer_tenant_id","supplier_tenant_id");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_id_customer_tenant_unique" UNIQUE("id","customer_tenant_id");--> statement-breakpoint
ALTER TABLE "investigator_profiles" ADD CONSTRAINT "investigator_profiles_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
CREATE INDEX "assignments_customer_tenant_idx" ON "assignments" USING btree ("customer_tenant_id","status");--> statement-breakpoint
CREATE INDEX "assignments_supplier_tenant_idx" ON "assignments" USING btree ("supplier_tenant_id","status");--> statement-breakpoint
CREATE INDEX "quotes_supplier_tenant_idx" ON "quotes" USING btree ("supplier_tenant_id","status");--> statement-breakpoint
CREATE INDEX "quotes_customer_tenant_idx" ON "quotes" USING btree ("customer_tenant_id");--> statement-breakpoint
CREATE INDEX "media_assets_tenant_idx" ON "media_assets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "missions_customer_tenant_idx" ON "missions" USING btree ("customer_tenant_id","status");--> statement-breakpoint
CREATE INDEX "customer_profiles_tenant_idx" ON "customer_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investigator_profiles_tenant_user_unique" ON "investigator_profiles" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "investigator_profiles_tenant_idx" ON "investigator_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "service_areas_tenant_idx" ON "service_areas" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "assignment_status_history" ADD CONSTRAINT "assignment_history_parties_fk" FOREIGN KEY ("assignment_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."assignments"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_quote_parties_fk" FOREIGN KEY ("quote_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."quotes"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_mission_customer_tenant_fk" FOREIGN KEY ("mission_id","customer_tenant_id") REFERENCES "public"."missions"("id","customer_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_profile_supplier_tenant_fk" FOREIGN KEY ("investigator_profile_id","supplier_tenant_id") REFERENCES "public"."investigator_profiles"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_screenings" ADD CONSTRAINT "mission_screenings_mission_tenant_fk" FOREIGN KEY ("mission_id","customer_tenant_id") REFERENCES "public"."missions"("id","customer_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_status_history" ADD CONSTRAINT "mission_status_history_mission_tenant_fk" FOREIGN KEY ("mission_id","customer_tenant_id") REFERENCES "public"."missions"("id","customer_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_customer_tenant_id_tenants_id_fk" FOREIGN KEY ("customer_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_availability" ADD CONSTRAINT "investigator_availability_profile_tenant_fk" FOREIGN KEY ("profile_id","tenant_id") REFERENCES "public"."investigator_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_languages" ADD CONSTRAINT "investigator_languages_profile_tenant_fk" FOREIGN KEY ("profile_id","tenant_id") REFERENCES "public"."investigator_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_profiles" ADD CONSTRAINT "investigator_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigator_specialties" ADD CONSTRAINT "investigator_specialties_profile_tenant_fk" FOREIGN KEY ("profile_id","tenant_id") REFERENCES "public"."investigator_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_profile_tenant_fk" FOREIGN KEY ("profile_id","tenant_id") REFERENCES "public"."investigator_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_decisions" ADD CONSTRAINT "verification_decisions_request_tenant_fk" FOREIGN KEY ("request_id","tenant_id") REFERENCES "public"."verification_requests"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_request_documents" ADD CONSTRAINT "verification_documents_request_tenant_fk" FOREIGN KEY ("request_id","tenant_id") REFERENCES "public"."verification_requests"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_request_documents" ADD CONSTRAINT "verification_documents_asset_tenant_fk" FOREIGN KEY ("media_asset_id","tenant_id") REFERENCES "public"."media_assets"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_profile_tenant_fk" FOREIGN KEY ("profile_id","tenant_id") REFERENCES "public"."investigator_profiles"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Triggers. Each runs with the invoker's privileges and a fixed search_path (db-migration skill).
-- Owner columns: the context's workspace when there is one (the column default already put it
-- there), else the owning user's Personal workspace. Arguments: the tenant column, the user column.
CREATE FUNCTION fill_owner_tenant() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  current_row jsonb := to_jsonb(NEW);
BEGIN
  IF current_row ->> TG_ARGV[0] IS NULL THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      TG_ARGV[0], app_tenant_for_user((current_row ->> TG_ARGV[1])::uuid)));
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- Copied parties: ALWAYS from the parent row, never from the request. Arguments: the parent
-- table, the foreign-key column, then one 'child_column:parent_column' pair per party. A missing
-- parent leaves the party NULL, and the insert fails as it would have for the missing parent.
CREATE FUNCTION fill_party_from_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  parent jsonb;
  i integer;
BEGIN
  EXECUTE format('SELECT to_jsonb(p) FROM %I p WHERE p.id = $1', TG_ARGV[0])
    INTO parent
    USING (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  FOR i IN 2 .. TG_NARGS - 1 LOOP
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      split_part(TG_ARGV[i], ':', 1), parent ->> split_part(TG_ARGV[i], ':', 2)));
  END LOOP;
  RETURN NEW;
END $$;--> statement-breakpoint
-- A row never moves to another workspace. Arguments: the tenant and party columns.
CREATE FUNCTION forbid_tenant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  i integer;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    IF (to_jsonb(NEW) ->> TG_ARGV[i]) IS DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[i]) THEN
      RAISE EXCEPTION 'tenant_columns_immutable: %.% never changes after insert', TG_TABLE_NAME, TG_ARGV[i]
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tenant_columns_immutable';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_profiles_fill_tenant BEFORE INSERT ON customer_profiles
  FOR EACH ROW EXECUTE FUNCTION fill_owner_tenant('tenant_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER investigator_profiles_fill_tenant BEFORE INSERT ON investigator_profiles
  FOR EACH ROW EXECUTE FUNCTION fill_owner_tenant('tenant_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER media_assets_fill_tenant BEFORE INSERT ON media_assets
  FOR EACH ROW EXECUTE FUNCTION fill_owner_tenant('tenant_id', 'owner_id');--> statement-breakpoint
CREATE TRIGGER idempotency_keys_fill_tenant BEFORE INSERT ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION fill_owner_tenant('tenant_id', 'actor_id');--> statement-breakpoint
CREATE TRIGGER missions_fill_tenant BEFORE INSERT ON missions
  FOR EACH ROW EXECUTE FUNCTION fill_owner_tenant('customer_tenant_id', 'customer_id');--> statement-breakpoint
CREATE TRIGGER investigator_languages_fill_from_profile BEFORE INSERT ON investigator_languages
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('investigator_profiles', 'profile_id', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER investigator_specialties_fill_from_profile BEFORE INSERT ON investigator_specialties
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('investigator_profiles', 'profile_id', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER investigator_availability_fill_from_profile BEFORE INSERT ON investigator_availability
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('investigator_profiles', 'profile_id', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER service_areas_fill_from_profile BEFORE INSERT ON service_areas
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('investigator_profiles', 'profile_id', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER verification_requests_fill_from_profile BEFORE INSERT ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('investigator_profiles', 'profile_id', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER verification_request_documents_fill_from_request BEFORE INSERT ON verification_request_documents
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('verification_requests', 'request_id', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER verification_decisions_fill_from_request BEFORE INSERT ON verification_decisions
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('verification_requests', 'request_id', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER mission_status_history_fill_from_mission BEFORE INSERT ON mission_status_history
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('missions', 'mission_id', 'customer_tenant_id:customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER mission_screenings_fill_from_mission BEFORE INSERT ON mission_screenings
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('missions', 'mission_id', 'customer_tenant_id:customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER quotes_fill_from_mission BEFORE INSERT ON quotes
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('missions', 'mission_id', 'customer_tenant_id:customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER quotes_fill_from_profile BEFORE INSERT ON quotes
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('investigator_profiles', 'investigator_profile_id', 'supplier_tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER assignments_fill_from_quote BEFORE INSERT ON assignments
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('quotes', 'quote_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER assignment_status_history_fill_from_assignment BEFORE INSERT ON assignment_status_history
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('assignments', 'assignment_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER assignment_status_history_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON assignment_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER assignments_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON assignments
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER customer_profiles_tenant_immutable BEFORE UPDATE OF tenant_id ON customer_profiles
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER idempotency_keys_tenant_immutable BEFORE UPDATE OF tenant_id ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER investigator_availability_tenant_immutable BEFORE UPDATE OF tenant_id ON investigator_availability
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER investigator_languages_tenant_immutable BEFORE UPDATE OF tenant_id ON investigator_languages
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER investigator_profiles_tenant_immutable BEFORE UPDATE OF tenant_id ON investigator_profiles
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER investigator_specialties_tenant_immutable BEFORE UPDATE OF tenant_id ON investigator_specialties
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER media_assets_tenant_immutable BEFORE UPDATE OF tenant_id ON media_assets
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER mission_screenings_tenant_immutable BEFORE UPDATE OF customer_tenant_id ON mission_screenings
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER mission_status_history_tenant_immutable BEFORE UPDATE OF customer_tenant_id ON mission_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER missions_tenant_immutable BEFORE UPDATE OF customer_tenant_id ON missions
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id');--> statement-breakpoint
CREATE TRIGGER quotes_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON quotes
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER service_areas_tenant_immutable BEFORE UPDATE OF tenant_id ON service_areas
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER verification_decisions_tenant_immutable BEFORE UPDATE OF tenant_id ON verification_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER verification_request_documents_tenant_immutable BEFORE UPDATE OF tenant_id ON verification_request_documents
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE TRIGGER verification_requests_tenant_immutable BEFORE UPDATE OF tenant_id ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');
