import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { currentContext } from '../../common/context/execution-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { knowledgeChunks, knowledgeDocuments, type KnowledgeLocale } from '../../database/schema';
import { knowledgeReader, mayRead } from './knowledge-reader';

/** A help article as a reader opens it: its sections in order, in their language or English. */
export interface KnowledgeDocumentView {
  docKey: string;
  version: number;
  title: string;
  /** The language it is in. */
  locale: string;
  /** True when it is in English because it has no current version in the language asked for. */
  fallback: boolean;
  sections: Array<{ heading: string; content: string }>;
}

/**
 * Opening one help article (T-059) — the page a citation links to.
 *
 * The same gate as retrieval (`mayRead`, T-017): a current document, of an audience and visibility
 * this reader holds, the platform's or this workspace's own. A document the reader may not read is
 * the same 404 as one that does not exist, so a key says nothing about what is behind it. Sections
 * are gated again one by one, as retrieval gates chunks. Reading guidance is not audited: it is the
 * platform's own documentation, not anyone's data.
 */
@Injectable()
export class KnowledgeDocumentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
  ) {}

  async read(
    actor: Actor,
    docKey: string,
    locale: KnowledgeLocale,
    req: RequestContext,
  ): Promise<KnowledgeDocumentView> {
    const c: AuthzContext = {
      action: 'knowledge.document_read',
      resourceType: 'knowledge_document',
      resourceId: docKey,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
    await this.authz.requireActive(actor, c);
    const context = currentContext();
    await this.authz.requireWorkspace(actor, context !== undefined, c);
    const reader = knowledgeReader(actor, context!);

    const rows = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.docKey, docKey),
          eq(knowledgeDocuments.status, 'current'),
          inArray(knowledgeDocuments.locale, [...new Set([locale, 'en'])]),
        ),
      );
    const readable = rows.filter((r) => mayRead(reader, r));
    const doc =
      readable.find((r) => r.locale === locale) ?? readable.find((r) => r.locale === 'en');
    if (doc === undefined) throw AppError.notFound();

    const chunks = await this.db
      .select({
        heading: knowledgeChunks.heading,
        content: knowledgeChunks.content,
        visibility: knowledgeChunks.visibility,
      })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, doc.id))
      .orderBy(asc(knowledgeChunks.ordinal));

    return {
      docKey: doc.docKey,
      version: doc.version,
      title: doc.title,
      locale: doc.locale,
      fallback: doc.locale !== locale,
      sections: chunks
        .filter((s) => reader.visibilities.includes(s.visibility))
        .map(({ heading, content }) => ({ heading, content })),
    };
  }
}
