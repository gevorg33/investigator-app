-- T-021: which exact text this person agreed to, in which language, and when.
--
-- A published document never changes. That is what makes a consent record provable: the row
-- carries a copy of the hash, and the document it names cannot be edited to disagree with it.
-- A correction — even a typo — is a new version.
CREATE TYPE "public"."legal_document_type" AS ENUM('PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'TERMS_AND_CONDITIONS', 'LAWFUL_USE_POLICY', 'INVESTIGATOR_AGREEMENT', 'AGENCY_AGREEMENT');--> statement-breakpoint
CREATE TYPE "public"."legal_document_status" AS ENUM('DRAFT', 'CURRENT', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."consent_action" AS ENUM('ACCEPTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."consent_context" AS ENUM('REGISTRATION', 'REACCEPTANCE', 'ROLE_ACTIVATION', 'AGENCY_CREATION');--> statement-breakpoint

CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "legal_document_type" NOT NULL,
	"version" integer NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" "legal_document_status" DEFAULT 'DRAFT' NOT NULL,
	"is_authoritative_locale" boolean DEFAULT false NOT NULL,
	"requires_reacceptance" boolean DEFAULT true NOT NULL,
	"supersedes_id" uuid,
	"effective_from" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_version_locale_unique" UNIQUE("type","version","locale"),
	-- Published means dated: a version nobody can say when it took effect is not evidence.
	CONSTRAINT "legal_documents_published_is_dated" CHECK (
		status = 'DRAFT' OR (published_at IS NOT NULL AND effective_from IS NOT NULL)),
	CONSTRAINT "legal_documents_version_positive" CHECK (version >= 1),
	CONSTRAINT "legal_documents_supersedes_is_not_self" CHECK (supersedes_id IS DISTINCT FROM id)
);--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_supersedes_id_fk"
	FOREIGN KEY ("supersedes_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict;--> statement-breakpoint

-- "The current terms in English" must name exactly one row, and exactly one locale per version
-- governs; the rest are translations of it.
CREATE UNIQUE INDEX "legal_documents_one_current" ON "legal_documents" ("type","locale") WHERE status = 'CURRENT';--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_one_authoritative" ON "legal_documents" ("type","version") WHERE is_authoritative_locale;--> statement-breakpoint
CREATE INDEX "legal_documents_lookup_idx" ON "legal_documents" ("type","status","locale");--> statement-breakpoint

-- The hash is the database's, not a caller's: one that a writer chooses is one that can
-- disagree with the text it claims to describe. sha256() is built in — no extension needed.
CREATE FUNCTION legal_document_hash() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.content_hash := encode(sha256(convert_to(NEW.content, 'UTF8')), 'hex');
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER legal_documents_hash
	BEFORE INSERT OR UPDATE ON legal_documents
	FOR EACH ROW EXECUTE FUNCTION legal_document_hash();--> statement-breakpoint

-- Published text is immutable. Only the status may move on — CURRENT to SUPERSEDED when a
-- newer version takes over. Everything else about a published version is settled for good,
-- because every consent record that names it depends on that.
CREATE FUNCTION forbid_published_document_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF NEW.type IS DISTINCT FROM OLD.type
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.locale IS DISTINCT FROM OLD.locale
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.is_authoritative_locale IS DISTINCT FROM OLD.is_authoritative_locale
     OR NEW.requires_reacceptance IS DISTINCT FROM OLD.requires_reacceptance
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'legal_documents_published_immutable: a published version never changes; correct it with a new one'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'legal_documents_published_immutable';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER legal_documents_published_immutable
	BEFORE UPDATE ON legal_documents
	FOR EACH ROW EXECUTE FUNCTION forbid_published_document_change();--> statement-breakpoint

CREATE TABLE "user_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- No foreign key to users: consent outlives the account it was given by.
	"user_id" uuid NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"document_type" "legal_document_type" NOT NULL,
	"document_version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"locale_shown" text NOT NULL,
	"action" "consent_action" NOT NULL,
	"context" "consent_context" NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant(),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"correlation_id" text
);--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_legal_document_id_fk"
	FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict;--> statement-breakpoint
CREATE INDEX "user_consents_user_document_idx" ON "user_consents" ("user_id","document_type","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "user_consents_document_idx" ON "user_consents" ("legal_document_id");--> statement-breakpoint

-- What the row says about the document is copied from it, and must agree with it. Checked
-- here rather than trusted: the copy is the evidence, so a wrong copy is a forged record.
CREATE FUNCTION assert_consent_matches_document() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  doc legal_documents%ROWTYPE;
BEGIN
  SELECT * INTO doc FROM legal_documents WHERE id = NEW.legal_document_id;
  IF doc.status = 'DRAFT' THEN
    RAISE EXCEPTION 'user_consents_document_published: nobody can agree to an unpublished draft'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'user_consents_document_published';
  END IF;
  IF NEW.document_type IS DISTINCT FROM doc.type
     OR NEW.document_version IS DISTINCT FROM doc.version
     OR NEW.content_hash IS DISTINCT FROM doc.content_hash
     OR NEW.locale_shown IS DISTINCT FROM doc.locale THEN
    RAISE EXCEPTION 'user_consents_matches_document: the copied type, version, hash and locale must be the document''s own'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'user_consents_matches_document';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER user_consents_matches_document
	BEFORE INSERT ON user_consents
	FOR EACH ROW EXECUTE FUNCTION assert_consent_matches_document();--> statement-breakpoint

-- The application publishes nothing: documents are data a compliance owner puts in, and code
-- reads. Consents are append-only, exactly like audit_logs — withdrawal appends a row.
GRANT SELECT ON legal_documents TO investigator_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON legal_documents FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT ON user_consents TO investigator_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON user_consents FROM investigator_app;
