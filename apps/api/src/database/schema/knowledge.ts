import { sql, type SQL } from 'drizzle-orm';
import {
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * The embedding width. `text-embedding-3-small` (ADR-0001) is 1536; a model of another width is a
 * migration, not a setting — every stored vector would have to be recomputed anyway.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** The locales a document may be written in — the migration's `knowledge_documents_locale_known`. */
export const KNOWLEDGE_LOCALES = ['en', 'ru', 'hy'] as const;
export type KnowledgeLocale = (typeof KNOWLEDGE_LOCALES)[number];

export const knowledgeAudience = pgEnum('knowledge_audience', [
  'customer',
  'investigator',
  'agency',
  'staff',
  'public',
]);
export const knowledgeVisibility = pgEnum('knowledge_visibility', [
  'public',
  'authenticated',
  'participant',
  'staff',
]);
/**
 * `removed` is not a frontmatter value: it is what a document becomes when its file leaves the
 * repository. The row stays — an answer given from it can still be traced — and its chunks go.
 */
export const knowledgeDocumentStatus = pgEnum('knowledge_document_status', [
  'current',
  'superseded',
  'removed',
]);

/**
 * One version of one knowledge-base document in one locale (T-016, ADR-0001).
 *
 * Written only by the sync, from `docs/knowledge-base/**`, which is the source; this is the
 * derived copy retrieval reads. Every frontmatter field that decides who may see a document is a
 * column, so retrieval (T-017) filters on data rather than inferring from a folder.
 *
 * `tenant_id` is NULL for the platform knowledge base. An agency's own documents carry theirs
 * (T-097), and row-level security keeps each workspace to its own and the platform's.
 */
export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The frontmatter `id`, shared by a document's translations. */
    docKey: text('doc_key').notNull(),
    locale: text('locale').notNull(),
    version: integer('version').notNull(),
    status: knowledgeDocumentStatus('status').notNull(),
    title: text('title').notNull(),
    audience: knowledgeAudience('audience').notNull(),
    visibility: knowledgeVisibility('visibility').notNull(),
    sourceOfTruth: text('source_of_truth').notNull(),
    implementationStatus: text('implementation_status'),
    sourcePath: text('source_path').notNull(),
    relatedCode: text('related_code')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The frontmatter `updated` date: when a person last said this was true. */
    updatedOn: date('updated_on').notNull(),
    /** sha256 of the whole file. Unchanged content is a no-op. */
    contentHash: text('content_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    unique('knowledge_documents_version_unique')
      .on(t.tenantId, t.docKey, t.locale, t.version)
      .nullsNotDistinct(),
    // One current version per document and locale; NULLS NOT DISTINCT so the platform's count too.
    uniqueIndex('knowledge_documents_one_current')
      .on(t.tenantId, t.docKey, t.locale)
      .where(sql`${t.status} = 'current'`),
  ],
);

/**
 * One `## ` section of a current document — a question and its answer, retrieved alone (T-016).
 *
 * Only current documents have chunks: superseding or removing a document deletes its chunks in the
 * same transaction, so retrieval cannot return withdrawn guidance.
 *
 * `visibility` and `tenant_id` are copied from the document, so retrieval can filter before it
 * ranks. The embedding is NULL until a provider is configured; the model name and version are
 * stored beside it, and a chunk is re-embedded only when its content or the model changes.
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'restrict' }),
    ordinal: integer('ordinal').notNull(),
    heading: text('heading').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    tenantId: uuid('tenant_id').default(sql`app_current_tenant()`),
    visibility: knowledgeVisibility('visibility').notNull(),
    locale: text('locale').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text('embedding_model'),
    embeddingModelVersion: text('embedding_model_version'),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
    search: tsvector('search').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('simple', ${knowledgeChunks.heading} || ' ' || ${knowledgeChunks.content})`,
    ),
  },
  (t) => [
    unique('knowledge_chunks_ordinal_unique').on(t.documentId, t.ordinal),
    index('knowledge_chunks_search_idx').using('gin', t.search),
    index('knowledge_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('knowledge_chunks_pending_idx')
      .on(t.id)
      .where(sql`${t.embedding} IS NULL`),
  ],
);

export const knowledgeConflictStatus = pgEnum('knowledge_conflict_status', ['open', 'resolved']);

/**
 * Two current documents that may answer the same question for the same readers (T-016).
 *
 * Whether two answers actually contradict each other cannot be decided mechanically, so this
 * over-flags: the same question asked in two documents, or two answers whose embeddings are nearly
 * identical. Retrieval surfaces both with the conflict and never picks one (`evidence-integrity`);
 * a person resolves it by editing the documents, and the next sync closes it.
 */
export const knowledgeConflicts = pgTable(
  'knowledge_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentA: uuid('document_a')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'restrict' }),
    documentB: uuid('document_b')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'restrict' }),
    /** `same_question` or `near_duplicate`. */
    reason: text('reason').notNull(),
    /** The question both answer, normalised — what a person reads to judge it. */
    subject: text('subject').notNull(),
    status: knowledgeConflictStatus('status').notNull().default('open'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Copied from `document_a` by trigger. */
    tenantId: uuid('tenant_id').default(sql`app_current_tenant()`),
  },
  (t) => [
    unique('knowledge_conflicts_pair_unique').on(t.documentA, t.documentB, t.reason, t.subject),
  ],
);
