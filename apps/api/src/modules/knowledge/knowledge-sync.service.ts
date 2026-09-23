import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformContext } from '../../common/context/platform-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { knowledgeChunks, knowledgeConflicts, knowledgeDocuments } from '../../database/schema';
import { type Embedder, embeddingInput } from './embedder';
import type { ReviewedOverlap, SourceDocument } from './knowledge-source';

type DocumentRow = typeof knowledgeDocuments.$inferSelect;

/** Cosine similarity above which two answers in different documents are flagged (T-016). */
export const NEAR_DUPLICATE_SIMILARITY = 0.95;
const EMBED_BATCH = 64;

export interface SyncReport {
  created: string[];
  updated: string[];
  superseded: string[];
  removed: string[];
  unchanged: number;
  embedded: number;
  /** Chunks waiting for an embedder: every chunk, until a provider is configured. */
  pending: number;
  /** Overlaps found and set aside because someone read both answers at these versions. */
  reviewed: number;
  conflicts: Array<{ reason: string; subject: string; documents: [string, string] }>;
}

const label = (d: { docKey: string; locale: string; version: number }) =>
  `${d.locale}/${d.docKey}@${d.version}`;

/**
 * Makes the database's copy of the knowledge base match `docs/knowledge-base` (T-016).
 *
 * One transaction per document, so superseding or removing a document and dropping its chunks
 * commit together — retrieval never sees withdrawn guidance, and a trigger refuses the order that
 * would let it. Unchanged content is a no-op: the file's hash is compared first, and a chunk whose
 * text did not change keeps its embedding.
 *
 * Runs as the system inside PlatformContext, which is the only context the knowledge tables accept
 * writes from. The platform knowledge base has no workspace; an agency's own is T-097.
 */
@Injectable()
export class KnowledgeSyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly platform: PlatformContext,
    private readonly audit: AuditService,
  ) {}

  async sync(
    source: readonly SourceDocument[],
    embedder: Embedder | undefined,
    req: { correlationId?: string | undefined },
    reviewed: readonly ReviewedOverlap[] = [],
  ): Promise<SyncReport> {
    return this.platform.asSystem('knowledge.sync', req, async () => {
      const report: SyncReport = {
        created: [],
        updated: [],
        superseded: [],
        removed: [],
        unchanged: 0,
        embedded: 0,
        pending: 0,
        reviewed: 0,
        conflicts: [],
      };

      for (const doc of source) await this.syncOne(doc, report);

      // A file gone from the repository: its document is removed, and its chunks with it.
      const present = new Set(source.map((d) => `${d.docKey}|${d.locale}`));
      const current = await this.db
        .select()
        .from(knowledgeDocuments)
        .where(and(isNull(knowledgeDocuments.tenantId), eq(knowledgeDocuments.status, 'current')));
      for (const row of current.filter((r) => !present.has(`${r.docKey}|${r.locale}`))) {
        await this.db.transaction((tx) => this.retire(tx, row, 'removed'));
        report.removed.push(label(row));
      }

      if (embedder !== undefined) report.embedded = await this.embedPending(embedder);
      const [pending] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(knowledgeChunks)
        .where(isNull(knowledgeChunks.embedding));
      report.pending = pending!.n;

      const detected = await this.detectConflicts(reviewed);
      report.conflicts = detected.conflicts;
      report.reviewed = detected.reviewed;
      await this.audit.record({
        correlationId: req.correlationId,
        actorRole: 'SYSTEM',
        action: 'knowledge.synced',
        resourceType: 'knowledge_base',
        reason:
          `+${report.created.length} ~${report.updated.length} superseded ${report.superseded.length} ` +
          `removed ${report.removed.length} embedded ${report.embedded} conflicts ${report.conflicts.length}`,
      });
      return report;
    });
  }

  private async syncOne(doc: SourceDocument, report: SyncReport): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(knowledgeDocuments)
        .where(
          and(
            isNull(knowledgeDocuments.tenantId),
            eq(knowledgeDocuments.docKey, doc.docKey),
            eq(knowledgeDocuments.locale, doc.locale),
            eq(knowledgeDocuments.status, 'current'),
          ),
        )
        .for('update');

      if (current !== undefined && current.version === doc.version) {
        if (doc.status === 'superseded') {
          await this.retire(tx, current, 'superseded');
          report.superseded.push(label(current));
        } else if (current.contentHash === doc.contentHash) {
          report.unchanged += 1;
        } else {
          // Same version, new text: corrected in place. A change a reader could have acted on is
          // a new version, which supersedes this one (`documentation-first`).
          await tx
            .update(knowledgeDocuments)
            .set({ ...fields(doc), ingestedAt: new Date() })
            .where(eq(knowledgeDocuments.id, current.id));
          await this.replaceChunks(tx, current.id, doc);
          report.updated.push(label(doc));
        }
        return;
      }

      if (current !== undefined && current.version > doc.version) {
        // An older version than the one in force: the repository went backwards, which a sync must
        // not follow silently.
        throw new Error(
          `${doc.sourcePath}: version ${doc.version} is older than ingested ${current.version}`,
        );
      }
      if (doc.status === 'superseded') {
        report.unchanged += 1;
        return;
      }
      if (current !== undefined) {
        await this.retire(tx, current, 'superseded');
        report.superseded.push(label(current));
      }
      const [created] = await tx
        .insert(knowledgeDocuments)
        .values({ ...fields(doc), status: 'current' })
        .returning();
      await this.replaceChunks(tx, created!.id, doc);
      report.created.push(label(doc));
    });
  }

  /** Out of retrieval: chunks first, then the document — the order the trigger insists on. */
  private async retire(tx: Tx, row: DocumentRow, status: 'superseded' | 'removed'): Promise<void> {
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, row.id));
    await tx
      .update(knowledgeDocuments)
      .set({ status, retiredAt: new Date() })
      .where(eq(knowledgeDocuments.id, row.id));
  }

  /** New chunks for a document, keeping the embedding of any whose text did not change. */
  private async replaceChunks(tx: Tx, documentId: string, doc: SourceDocument): Promise<void> {
    const old = await tx
      .delete(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, documentId))
      .returning();
    const kept = new Map(old.filter((c) => c.embedding !== null).map((c) => [c.contentHash, c]));
    await tx.insert(knowledgeChunks).values(
      doc.chunks.map((c) => {
        const prior = kept.get(c.contentHash);
        return {
          documentId,
          ordinal: c.ordinal,
          heading: c.heading,
          content: c.content,
          contentHash: c.contentHash,
          // Replaced from the document by trigger; never the caller's to decide.
          visibility: doc.visibility,
          locale: doc.locale,
          embedding: prior?.embedding ?? null,
          embeddingModel: prior?.embeddingModel ?? null,
          embeddingModelVersion: prior?.embeddingModelVersion ?? null,
          embeddedAt: prior?.embeddedAt ?? null,
        };
      }),
    );
  }

  /** Every chunk without an embedding from this model and version, in batches. */
  private async embedPending(embedder: Embedder): Promise<number> {
    const stale = await this.db
      .select({
        id: knowledgeChunks.id,
        heading: knowledgeChunks.heading,
        content: knowledgeChunks.content,
      })
      .from(knowledgeChunks)
      .where(
        or(
          isNull(knowledgeChunks.embedding),
          ne(knowledgeChunks.embeddingModel, embedder.model),
          ne(knowledgeChunks.embeddingModelVersion, embedder.version),
        ),
      )
      .orderBy(knowledgeChunks.id);
    for (let i = 0; i < stale.length; i += EMBED_BATCH) {
      const batch = stale.slice(i, i + EMBED_BATCH);
      const vectors = await embedder.embed(batch.map(embeddingInput));
      await this.db.transaction(async (tx) => {
        const now = new Date();
        for (const [j, chunk] of batch.entries()) {
          await tx
            .update(knowledgeChunks)
            .set({
              embedding: vectors[j]!,
              embeddingModel: embedder.model,
              embeddingModelVersion: embedder.version,
              embeddedAt: now,
            })
            .where(eq(knowledgeChunks.id, chunk.id));
        }
      });
    }
    return stale.length;
  }

  /**
   * Two current platform documents, in one locale, for readers who overlap, that answer the same
   * question — by heading, or by an embedding close enough to be the same answer. Flagged, never
   * ranked; closed by the sync once the documents no longer overlap.
   */
  private async detectConflicts(
    reviewed: readonly ReviewedOverlap[],
  ): Promise<{ conflicts: SyncReport['conflicts']; reviewed: number }> {
    const found = (await this.db.execute(sql`
      WITH live AS (
        SELECT c.id, c.document_id, c.heading, c.embedding, d.locale, d.audience, d.doc_key, d.version
          FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
         WHERE d.status = 'current' AND d.tenant_id IS NULL
      )
      SELECT a.document_id AS document_a, b.document_id AS document_b,
             a.doc_key || '@' || a.version AS version_a, b.doc_key || '@' || b.version AS version_b,
             CASE WHEN ${question('a.heading')} = ${question('b.heading')}
                  THEN 'same_question' ELSE 'near_duplicate' END AS reason,
             ${question('a.heading')} AS subject
        FROM live a JOIN live b
          ON a.document_id < b.document_id
         AND a.locale = b.locale
         AND (a.audience = b.audience OR 'public' IN (a.audience, b.audience))
       WHERE ${question('a.heading')} = ${question('b.heading')}
          OR (a.embedding IS NOT NULL AND b.embedding IS NOT NULL
              AND 1 - (a.embedding <=> b.embedding) >= ${NEAR_DUPLICATE_SIMILARITY})`)) as unknown as Array<{
      document_a: string;
      document_b: string;
      version_a: string;
      version_b: string;
      reason: string;
      subject: string;
    }>;

    const key = (f: { document_a: string; document_b: string; reason: string; subject: string }) =>
      `${f.document_a}|${f.document_b}|${f.reason}|${f.subject}`;
    // Set aside what someone has read at exactly these versions; anything newer is flagged again.
    const isReviewed = (f: (typeof found)[number]) =>
      reviewed.some(
        (r) =>
          r.subject === f.subject &&
          [...r.documents].sort().join('|') === [f.version_a, f.version_b].sort().join('|'),
      );
    const all = [...new Map(found.map((f) => [key(f), f])).values()];
    const unique = all.filter((f) => !isReviewed(f));

    await this.db.transaction(async (tx) => {
      for (const f of unique) {
        await tx
          .insert(knowledgeConflicts)
          .values({
            documentA: f.document_a,
            documentB: f.document_b,
            reason: f.reason,
            subject: f.subject,
          })
          .onConflictDoUpdate({
            target: [
              knowledgeConflicts.documentA,
              knowledgeConflicts.documentB,
              knowledgeConflicts.reason,
              knowledgeConflicts.subject,
            ],
            set: { status: 'open', resolvedAt: null },
          });
      }
      const open = await tx
        .select()
        .from(knowledgeConflicts)
        .where(and(isNull(knowledgeConflicts.tenantId), eq(knowledgeConflicts.status, 'open')));
      const still = new Set(unique.map(key));
      const closed = open
        .filter(
          (c) =>
            !still.has(
              key({
                document_a: c.documentA,
                document_b: c.documentB,
                reason: c.reason,
                subject: c.subject,
              }),
            ),
        )
        .map((c) => c.id);
      if (closed.length > 0) {
        await tx
          .update(knowledgeConflicts)
          .set({ status: 'resolved', resolvedAt: new Date() })
          .where(inArray(knowledgeConflicts.id, closed));
      }
    });

    const reviewedCount = all.length - unique.length;
    if (unique.length === 0) return { conflicts: [], reviewed: reviewedCount };
    const docs = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(
        inArray(
          knowledgeDocuments.id,
          unique.flatMap((u) => [u.document_a, u.document_b]),
        ),
      );
    const byId = new Map(docs.map((d) => [d.id, d]));
    return {
      reviewed: reviewedCount,
      conflicts: unique.map((u) => ({
        reason: u.reason,
        subject: u.subject,
        // The file to open, and the id@version a review of it is recorded against — in path order,
        // since the pair's own order is by id and means nothing to a reader.
        documents: [
          `${byId.get(u.document_a)!.sourcePath} (${u.version_a})`,
          `${byId.get(u.document_b)!.sourcePath} (${u.version_b})`,
        ].sort() as [string, string],
      })),
    };
  }
}

/**
 * A question as people ask it, for comparing two documents: case, spacing and a trailing question
 * mark aside — including the Armenian one.
 */
const question = (column: string) =>
  sql.raw(
    `regexp_replace(btrim(regexp_replace(lower(${column}), '\\s+', ' ', 'g')), '[?？։]+$', '')`,
  );

const fields = (doc: SourceDocument) => ({
  docKey: doc.docKey,
  locale: doc.locale,
  version: doc.version,
  title: doc.title,
  audience: doc.audience,
  visibility: doc.visibility,
  sourceOfTruth: doc.sourceOfTruth,
  implementationStatus: doc.implementationStatus,
  sourcePath: doc.sourcePath,
  relatedCode: doc.relatedCode,
  tags: doc.tags,
  updatedOn: doc.updatedOn,
  contentHash: doc.contentHash,
});
