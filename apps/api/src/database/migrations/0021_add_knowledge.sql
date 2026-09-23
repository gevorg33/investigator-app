-- T-016: the knowledge base, ingested for retrieval (ADR-0001). Approved 2026-09-23: tables every
-- workspace reads and only the sync writes, under platform access; visibility stored for retrieval
-- (T-017) to filter on; superseding or removing a document drops its chunks in the same transaction.

CREATE TYPE "public"."knowledge_audience" AS ENUM('customer', 'investigator', 'agency', 'staff', 'public');--> statement-breakpoint
CREATE TYPE "public"."knowledge_conflict_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."knowledge_document_status" AS ENUM('current', 'superseded', 'removed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_visibility" AS ENUM('public', 'authenticated', 'participant', 'staff');--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant(),
	"visibility" "knowledge_visibility" NOT NULL,
	"locale" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_model_version" text,
	"embedded_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "heading" || ' ' || "content")) STORED,
	CONSTRAINT "knowledge_chunks_ordinal_unique" UNIQUE("document_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "knowledge_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_a" uuid NOT NULL,
	"document_b" uuid NOT NULL,
	"reason" text NOT NULL,
	"subject" text NOT NULL,
	"status" "knowledge_conflict_status" DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "knowledge_conflicts_pair_unique" UNIQUE("document_a","document_b","reason","subject")
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant(),
	"doc_key" text NOT NULL,
	"locale" text NOT NULL,
	"version" integer NOT NULL,
	"status" "knowledge_document_status" NOT NULL,
	"title" text NOT NULL,
	"audience" "knowledge_audience" NOT NULL,
	"visibility" "knowledge_visibility" NOT NULL,
	"source_of_truth" text NOT NULL,
	"implementation_status" text,
	"source_path" text NOT NULL,
	"related_code" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_on" date NOT NULL,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "knowledge_documents_version_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","doc_key","locale","version")
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_document_a_knowledge_documents_id_fk" FOREIGN KEY ("document_a") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_document_b_knowledge_documents_id_fk" FOREIGN KEY ("document_b") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING gin ("search");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_chunks_pending_idx" ON "knowledge_chunks" USING btree ("id") WHERE "knowledge_chunks"."embedding" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_one_current" ON "knowledge_documents" USING btree ("tenant_id","doc_key","locale") NULLS NOT DISTINCT WHERE "knowledge_documents"."status" = 'current';--> statement-breakpoint

-- ── documents ───────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "knowledge_documents"
  ADD CONSTRAINT "knowledge_documents_locale_known" CHECK ("locale" IN ('en', 'ru', 'hy')),
  ADD CONSTRAINT "knowledge_documents_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "knowledge_documents_source_of_truth" CHECK ("source_of_truth" IN ('docs', 'database')),
  ADD CONSTRAINT "knowledge_documents_implementation_status" CHECK (
    "implementation_status" IS NULL OR "implementation_status" IN ('specified', 'partial', 'implemented')
  ),
  -- Nothing from docs/operations/ is ever a knowledge document, whatever path it arrives by.
  ADD CONSTRAINT "knowledge_documents_from_knowledge_base" CHECK (
    "source_path" LIKE 'docs/knowledge-base/%' AND "source_path" NOT LIKE '%..%'
  ),
  ADD CONSTRAINT "knowledge_documents_retired_when_not_current" CHECK (
    ("status" = 'current') = ("retired_at" IS NULL)
  );--> statement-breakpoint

-- A document leaves `current` once and never returns, and not while it still has chunks: the
-- chunks go in the same transaction, or retrieval could return withdrawn guidance (T-016).
CREATE FUNCTION keep_knowledge_document_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'current' THEN
    RAISE EXCEPTION 'a superseded or removed document is kept as it was' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.tenant_id, NEW.doc_key, NEW.locale, NEW.version) IS DISTINCT FROM
     (OLD.tenant_id, OLD.doc_key, OLD.locale, OLD.version) THEN
    RAISE EXCEPTION 'a document keeps its key, locale and version' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'current' AND EXISTS (SELECT 1 FROM knowledge_chunks WHERE document_id = NEW.id) THEN
    RAISE EXCEPTION 'remove a document''s chunks before it stops being current' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER knowledge_documents_lifecycle BEFORE UPDATE ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION keep_knowledge_document_lifecycle();--> statement-breakpoint
CREATE TRIGGER knowledge_documents_tenant_immutable BEFORE UPDATE OF tenant_id ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint

-- ── chunks ──────────────────────────────────────────────────────────────────────────────────────
-- Who may see a chunk is its document's business: copied, never supplied.
CREATE TRIGGER knowledge_chunks_fill_from_document BEFORE INSERT ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('knowledge_documents', 'document_id', 'tenant_id:tenant_id', 'visibility:visibility', 'locale:locale');--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_tenant_immutable BEFORE UPDATE OF tenant_id ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint

CREATE FUNCTION keep_knowledge_chunk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM knowledge_documents WHERE id = NEW.document_id AND status = 'current') THEN
      RAISE EXCEPTION 'only a current document has chunks' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- An update is the embedding arriving, nothing else: the text is the document's, not the embedder's.
  -- `search` is left out because a BEFORE trigger sees a stored generated column as NULL in NEW; it
  -- is derived from heading and content, which are compared.
  IF (to_jsonb(NEW) - 'embedding' - 'embedding_model' - 'embedding_model_version' - 'embedded_at' - 'search')
     IS DISTINCT FROM (to_jsonb(OLD) - 'embedding' - 'embedding_model' - 'embedding_model_version' - 'embedded_at' - 'search') THEN
    RAISE EXCEPTION 'a chunk''s text changes only by replacing the chunk' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_kept BEFORE INSERT OR UPDATE ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION keep_knowledge_chunk();--> statement-breakpoint

ALTER TABLE "knowledge_chunks"
  -- An embedding is never anonymous: which model made it is what makes it comparable.
  ADD CONSTRAINT "knowledge_chunks_embedding_attributed" CHECK (
    ("embedding" IS NULL) = ("embedding_model" IS NULL)
    AND ("embedding" IS NULL) = ("embedding_model_version" IS NULL)
    AND ("embedding" IS NULL) = ("embedded_at" IS NULL)
  ),
  ADD CONSTRAINT "knowledge_chunks_ordinal_non_negative" CHECK ("ordinal" >= 0);--> statement-breakpoint

-- ── conflicts ───────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "knowledge_conflicts" ADD COLUMN "tenant_id" uuid DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "knowledge_conflicts"
  -- One row per pair, whichever order they were found in.
  ADD CONSTRAINT "knowledge_conflicts_ordered_pair" CHECK ("document_a" < "document_b"),
  ADD CONSTRAINT "knowledge_conflicts_reason_known" CHECK ("reason" IN ('same_question', 'near_duplicate')),
  ADD CONSTRAINT "knowledge_conflicts_resolved_when_closed" CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL));--> statement-breakpoint
CREATE TRIGGER knowledge_conflicts_fill_from_document BEFORE INSERT ON knowledge_conflicts
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('knowledge_documents', 'document_a', 'tenant_id:tenant_id');--> statement-breakpoint
CREATE TRIGGER knowledge_conflicts_tenant_immutable BEFORE UPDATE OF tenant_id ON knowledge_conflicts
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('tenant_id');--> statement-breakpoint
CREATE INDEX "knowledge_conflicts_open_idx" ON "knowledge_conflicts" ("tenant_id") WHERE status = 'open';--> statement-breakpoint

-- ── grants: the REVOKEs do the work ─────────────────────────────────────────────────────────────
-- Documents and conflicts are kept; only chunks are ever deleted, and only by the sync.
REVOKE ALL ON knowledge_documents FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON knowledge_chunks FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON knowledge_conflicts FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON knowledge_documents TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_chunks TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON knowledge_conflicts TO investigator_app;--> statement-breakpoint

-- ── row-level security ──────────────────────────────────────────────────────────────────────────
-- Read: the platform's rows (no tenant) in any context — visibility is filtered by retrieval on every
-- query — and a workspace's own rows in that workspace (T-097). Write: the sync, under platform access.
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_or_own_reads ON knowledge_documents FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY sync_writes ON knowledge_documents FOR INSERT WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY sync_updates ON knowledge_documents FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE knowledge_chunks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_or_own_reads ON knowledge_chunks FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY sync_writes ON knowledge_chunks FOR INSERT WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY sync_updates ON knowledge_chunks FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY sync_deletes ON knowledge_chunks FOR DELETE USING (app_platform_access());--> statement-breakpoint

ALTER TABLE knowledge_conflicts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE knowledge_conflicts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_or_own_reads ON knowledge_conflicts FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant() OR app_platform_access());--> statement-breakpoint
CREATE POLICY sync_writes ON knowledge_conflicts FOR INSERT WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY sync_updates ON knowledge_conflicts FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());
