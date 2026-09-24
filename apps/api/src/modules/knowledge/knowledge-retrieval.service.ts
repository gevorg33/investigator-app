import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { currentContext } from '../../common/context/execution-context';
import { DB, type Db } from '../../database/database.module';
import { knowledgeChunks, knowledgeDocuments, type KnowledgeLocale } from '../../database/schema';
import { EMBEDDER, type Embedder } from './embedder';
import { mayRead, type KnowledgeReader } from './knowledge-reader';

/** How many candidates each leg returns. Over-fetched, so the gate does not starve the context. */
export const CANDIDATES = 40;
/** How many chunks, at most, reach a prompt. */
export const CONTEXT_CHUNKS = 8;
/** The reciprocal rank fusion constant, as the method's authors set it. */
const RRF_K = 60;
/**
 * Below this cosine similarity a chunk is not a vector candidate at all. Provisional, and tied to
 * the embedding model: unrelated text scores near zero, related text well above this. The model
 * is the second gate — it may still find nothing among the candidates and say so.
 */
export const MIN_VECTOR_SIMILARITY = 0.3;

/** One chunk, authorized, as it may reach a prompt and a citation. */
export interface RetrievedChunk {
  id: string;
  docKey: string;
  version: number;
  title: string;
  locale: string;
  heading: string;
  content: string;
}

export interface Retrieval {
  chunks: RetrievedChunk[];
  /** True when any chunk is in English because the document has no version in the locale asked for. */
  fallback: boolean;
}

/**
 * Permission-aware hybrid retrieval over the knowledge base (T-017, ADR-0001).
 *
 * ```
 * scope (reader, workspace, locale) → lexical leg ─┐
 *                                  → vector leg  ─┴─ RRF → load by id → gate → top 8
 * ```
 *
 * Both legs run inside the reader's scope and return ids only. The rows are then loaded by id and
 * every one passes `mayRead` again before it can be returned — the query is a pre-filter, the gate
 * is the authorization (`permission-aware-rag`). Row-level security keeps each workspace to the
 * platform's documents and its own; it does not filter by audience, which is why the gate exists.
 */
@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMBEDDER) private readonly embedder: Embedder | null,
  ) {}

  async retrieve(
    reader: KnowledgeReader,
    question: string,
    locale: KnowledgeLocale,
  ): Promise<Retrieval> {
    // Programming error, not a user one: every request runs in a workspace (T-077).
    if (currentContext() === undefined) {
      throw new Error('knowledge retrieval needs a workspace context');
    }

    const scope = this.scope(reader, locale);
    const legs = [await this.lexical(scope, question)];
    if (this.embedder !== null) legs.push(await this.vector(scope, question, this.embedder));
    const ranked = fuse(legs);
    if (ranked.length === 0) return { chunks: [], fallback: false };

    const rows = await this.db
      .select({
        id: knowledgeChunks.id,
        heading: knowledgeChunks.heading,
        content: knowledgeChunks.content,
        locale: knowledgeChunks.locale,
        visibility: knowledgeChunks.visibility,
        tenantId: knowledgeChunks.tenantId,
        docKey: knowledgeDocuments.docKey,
        version: knowledgeDocuments.version,
        title: knowledgeDocuments.title,
        status: knowledgeDocuments.status,
        audience: knowledgeDocuments.audience,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
      .where(inArray(knowledgeChunks.id, ranked));
    // In fused order. A chunk deleted since the search is simply not among the rows.
    const rank = new Map(ranked.map((id, i) => [id, i]));
    rows.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);

    const chunks: RetrievedChunk[] = [];
    for (const row of rows) {
      // Dropped, not substituted: a row that fails the gate leaves a gap, never a paraphrase.
      if (!mayRead(reader, row)) continue;
      chunks.push({
        id: row.id,
        docKey: row.docKey,
        version: row.version,
        title: row.title,
        locale: row.locale,
        heading: row.heading,
        content: row.content,
      });
      if (chunks.length === CONTEXT_CHUNKS) break;
    }
    return { chunks, fallback: chunks.some((c) => c.locale !== locale) };
  }

  /**
   * The reader's scope, as a predicate over `c` (chunk) and `d` (document): current documents of
   * an audience and visibility the reader holds, the platform's or this workspace's, in the locale
   * asked for — or in English where the document has no version in it.
   */
  protected scope(reader: KnowledgeReader, locale: KnowledgeLocale): SQL {
    return sql`d.status = 'current'
      AND d.audience::text IN ${reader.audiences}
      AND c.visibility::text IN ${reader.visibilities}
      AND (c.tenant_id IS NULL OR c.tenant_id = app_current_tenant())
      AND (c.locale = ${locale}
           OR (c.locale = 'en' AND NOT EXISTS (
                 SELECT 1 FROM knowledge_documents t
                  WHERE t.doc_key = d.doc_key AND t.locale = ${locale} AND t.status = 'current'
                    AND t.tenant_id IS NOT DISTINCT FROM d.tenant_id)))`;
  }

  /**
   * Words, weighted by how rare they are among the chunks this reader may see — PostgreSQL's own
   * ranking has no such weighting, so "how do I" would count as much as "refund". A word in more
   * than half of them carries no signal and counts for nothing, which is a stop-word list that
   * needs no language. Counted over the reader's scope only, so a hidden document never shapes a
   * ranking, even statistically. A word in the section's heading counts twice: headings are written
   * as people ask (`documentation-first`), so they are where a question's words mean the most.
   */
  private async lexical(scope: SQL, question: string): Promise<string[]> {
    const rows = (await this.db.execute(sql`
      WITH q AS (
        SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('simple', ${question}))) AS term
      ),
      allowed AS (
        SELECT c.id, tsvector_to_array(c.search) AS words,
               tsvector_to_array(to_tsvector('simple', c.heading)) AS asked
          FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
         WHERE ${scope}
      ),
      n AS (SELECT count(*)::float8 AS total FROM allowed),
      weights AS (
        SELECT q.term, ln((n.total + 1) / (count(a.id) + 0.5)) AS w
          FROM q CROSS JOIN n JOIN allowed a ON q.term = ANY (a.words)
         GROUP BY q.term, n.total
        HAVING count(a.id) <= greatest(1, n.total / 2)
      )
      SELECT a.id
        FROM allowed a JOIN weights ON weights.term = ANY (a.words)
       GROUP BY a.id
       ORDER BY sum(weights.w * CASE WHEN weights.term = ANY (a.asked) THEN 2 ELSE 1 END) DESC, a.id
       LIMIT ${CANDIDATES}`)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /**
   * Nearest chunks by cosine distance, compared only with vectors this embedder made: during a
   * model change one column holds two models' vectors, and a distance across them means nothing.
   */
  private async vector(scope: SQL, question: string, embedder: Embedder): Promise<string[]> {
    const [embedding] = await embedder.embed([question]);
    const vector = `[${embedding!.join(',')}]`;
    const rows = (await this.db.execute(sql`
      SELECT c.id
        FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
       WHERE ${scope}
         AND c.embedding IS NOT NULL
         AND c.embedding_model = ${embedder.model}
         AND c.embedding_model_version = ${embedder.version}
         AND 1 - (c.embedding <=> ${vector}::vector) >= ${MIN_VECTOR_SIMILARITY}
       ORDER BY c.embedding <=> ${vector}::vector, c.id
       LIMIT ${CANDIDATES}`)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}

/** Reciprocal rank fusion: each leg votes 1/(k + rank) for what it found; ties keep id order. */
export function fuse(legs: readonly (readonly string[])[]): string[] {
  const score = new Map<string, number>();
  for (const leg of legs) {
    leg.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}
