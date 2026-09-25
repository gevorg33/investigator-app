import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { legalDocuments, userConsents } from '../../database/schema';

export type LegalDocumentType = (typeof legalDocuments.type.enumValues)[number];

/**
 * What to tell someone who has not accepted each document. Written out, not built from the type:
 * the clients' catalogs need an entry for every key the API can send, and a test finds them by
 * reading the source (T-135). A `Record` over the enum also fails to compile when a type is added.
 */
export const ACCEPTANCE_REQUIRED_KEY: Record<LegalDocumentType, string> = {
  PRIVACY_POLICY: 'error.validation.legal.privacy_policy',
  TERMS_OF_SERVICE: 'error.validation.legal.terms_of_service',
  TERMS_AND_CONDITIONS: 'error.validation.legal.terms_and_conditions',
  LAWFUL_USE_POLICY: 'error.validation.legal.lawful_use_policy',
  INVESTIGATOR_AGREEMENT: 'error.validation.legal.investigator_agreement',
  AGENCY_AGREEMENT: 'error.validation.legal.agency_agreement',
};
export type ConsentContext = (typeof userConsents.context.enumValues)[number];

/** A published document, as it would be shown and as it would be proved afterwards. */
export interface PublishedDocument {
  id: string;
  type: LegalDocumentType;
  version: number;
  locale: string;
  title: string;
  content: string;
  contentHash: string;
  effectiveFrom: Date;
  /** True when this locale is the one that governs; the others are translations of it. */
  authoritative: boolean;
}

/** What is true right now, for one person and one kind of document. */
export interface ConsentState {
  type: LegalDocumentType;
  /** The version they last accepted, or null if they never have — or have withdrawn. */
  acceptedVersion: number | null;
  /** The version they would be accepting now. */
  currentVersion: number;
  /** Whether the product may proceed without asking again. */
  satisfied: boolean;
}

/**
 * Versioned legal documents and append-only consent records (T-021, `legal-consent`).
 *
 * A consent record must answer, years later and to a hostile reader: **which exact text did this
 * person agree to, in which language, and when?** So the row copies the document's hash rather
 * than joining to it, the document it names can never be edited, and a withdrawal appends
 * instead of deleting. None of that is enforced here alone — the triggers and grants in
 * migration 0015 hold it against any writer, this service being only the usual one.
 *
 * What this service does **not** decide: the text, whether a change is material, which locale
 * governs, or which documents a given flow requires. Those are the compliance owner's, recorded
 * as data on the document; the gates that read them are T-022 (registration, role activation)
 * and T-083 (agency terms).
 */
@Injectable()
export class LegalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * The version in force for `type`, in `locale` where that translation exists and in the
   * authoritative locale otherwise.
   *
   * Falling back rather than failing is deliberate: someone reading Armenian should still be
   * able to see the terms, and what they were shown is recorded either way. Which locale they
   * saw is the part that has to be true.
   */
  async currentDocument(type: LegalDocumentType, locale?: string): Promise<PublishedDocument> {
    const current = await this.db
      .select()
      .from(legalDocuments)
      .where(and(eq(legalDocuments.type, type), eq(legalDocuments.status, 'CURRENT')));

    const wanted = locale === undefined ? undefined : current.find((d) => d.locale === locale);
    const row = wanted ?? current.find((d) => d.isAuthoritativeLocale);
    // Nothing published yet is a real state — counsel's text arrives on its own schedule — and
    // "no terms exist" must never read as "these terms were accepted".
    if (row === undefined) throw AppError.notFound();

    return {
      id: row.id,
      type: row.type,
      version: row.version,
      locale: row.locale,
      title: row.title,
      content: row.content,
      contentHash: row.contentHash,
      // A CURRENT row always has both dates: legal_documents_published_is_dated.
      effectiveFrom: row.effectiveFrom!,
      authoritative: row.isAuthoritativeLocale,
    };
  }

  /**
   * What this person still has to accept, of the types asked about.
   *
   * A type with nothing published is **not** outstanding: there is no text to agree to, and a
   * gate that refused everybody until counsel delivered would be a gate on the wrong thing
   * (owner decision, 2026-09-21). The moment a version is published it becomes required, and a
   * material new version makes it outstanding again for people who accepted the old one.
   */
  async outstanding(
    userId: string,
    types: readonly LegalDocumentType[],
  ): Promise<PublishedDocument[]> {
    const pending: PublishedDocument[] = [];
    for (const type of types) {
      const document = await this.currentDocument(type).catch(() => undefined);
      if (document === undefined) continue;
      const state = await this.consentState(userId, type);
      if (!state.satisfied) pending.push(document);
    }
    return pending;
  }

  /**
   * The gate itself: every outstanding document of `types` must be among `acceptedDocumentIds`,
   * and is recorded in the caller's transaction (T-022).
   *
   * Refuses by naming the types still missing — a client can act on that, and it says nothing
   * about anyone else. Ids that are not outstanding are ignored rather than recorded twice:
   * accepting the same version again is not a second agreement.
   */
  async requireAcceptance(
    input: {
      userId: string;
      types: readonly LegalDocumentType[];
      acceptedDocumentIds: readonly string[];
      context: ConsentContext;
    },
    req: RequestContext,
    tx?: Tx,
  ): Promise<void> {
    const pending = await this.outstanding(input.userId, input.types);
    const missing = pending.filter((d) => !input.acceptedDocumentIds.includes(d.id));
    if (missing.length > 0) {
      throw AppError.validation(
        missing.map((d) => ({
          field: 'acceptedDocumentIds',
          code: 'ACCEPTANCE_REQUIRED',
          messageKey: ACCEPTANCE_REQUIRED_KEY[d.type],
        })),
      );
    }
    await this.acceptAll(
      { userId: input.userId, documentIds: pending.map((d) => d.id), context: input.context },
      req,
      tx,
    );
  }

  /**
   * Accepts several documents at once, in the caller's transaction — what a registration or a
   * role activation does. Every id must be the version currently in force for its type, so a
   * client cannot satisfy a gate by accepting something superseded.
   */
  async acceptAll(
    input: { userId: string; documentIds: readonly string[]; context: ConsentContext },
    req: RequestContext,
    tx?: Tx,
  ): Promise<void> {
    for (const documentId of input.documentIds) {
      await this.accept({ userId: input.userId, documentId, context: input.context }, req, tx);
    }
  }

  /**
   * Records an acceptance. Takes the transaction the surrounding work runs in, so an account and
   * its consent rows commit together or not at all — an account without them must not exist.
   */
  async accept(
    input: {
      userId: string;
      documentId: string;
      context: ConsentContext;
    },
    req: RequestContext,
    tx?: Tx,
  ): Promise<void> {
    await this.write('ACCEPTED', input, req, tx);
  }

  /**
   * Records a withdrawal, which appends: the acceptance that happened stays on the record.
   * Whether the product may still be used afterwards is the caller's question, not this one's.
   */
  async withdraw(
    input: { userId: string; documentId: string; context: ConsentContext },
    req: RequestContext,
    tx?: Tx,
  ): Promise<void> {
    await this.write('WITHDRAWN', input, req, tx);
  }

  /**
   * Whether this person needs to accept `type` before going on.
   *
   * Satisfied means: their latest row for this type is an acceptance, and it is either the
   * current version or an older one that the current version did not oblige them to re-accept
   * (the materiality flag, set by compliance and read here).
   */
  async consentState(userId: string, type: LegalDocumentType): Promise<ConsentState> {
    const current = await this.currentDocument(type);
    const [latest] = await this.db
      .select()
      .from(userConsents)
      .where(and(eq(userConsents.userId, userId), eq(userConsents.documentType, type)))
      .orderBy(desc(userConsents.occurredAt))
      .limit(1);

    if (latest === undefined || latest.action === 'WITHDRAWN') {
      return { type, acceptedVersion: null, currentVersion: current.version, satisfied: false };
    }
    const outdated = latest.documentVersion < current.version;
    return {
      type,
      acceptedVersion: latest.documentVersion,
      currentVersion: current.version,
      satisfied: !outdated || !(await this.reacceptanceRequired(type, latest.documentVersion)),
    };
  }

  /**
   * Whether any version published after `since` was flagged material. One non-material version
   * in between does not excuse a material one after it, so every version is asked, not just the
   * newest.
   */
  private async reacceptanceRequired(type: LegalDocumentType, since: number): Promise<boolean> {
    const newer = await this.db
      .select({ version: legalDocuments.version, requires: legalDocuments.requiresReacceptance })
      .from(legalDocuments)
      .where(eq(legalDocuments.type, type));
    return newer.some((d) => d.version > since && d.requires);
  }

  private async write(
    action: 'ACCEPTED' | 'WITHDRAWN',
    input: { userId: string; documentId: string; context: ConsentContext },
    req: RequestContext,
    tx?: Tx,
  ): Promise<void> {
    const [document] = await (tx ?? this.db)
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.id, input.documentId));
    if (document === undefined) throw AppError.notFound();

    // Copied, not joined: the document is immutable, so this copy can never be made to disagree
    // with it — and the database checks that it agrees at the moment it is written.
    await (tx ?? this.db).insert(userConsents).values({
      userId: input.userId,
      legalDocumentId: document.id,
      documentType: document.type,
      documentVersion: document.version,
      contentHash: document.contentHash,
      localeShown: document.locale,
      action,
      context: input.context,
      ipAddress: req.ip ?? null,
      userAgent: req.userAgent ?? null,
      correlationId: req.correlationId ?? null,
    });

    // The consent row and the audit entry are separate stores serving separate purposes; one is
    // the evidence, the other is the trail. Neither stands in for the other.
    await this.audit.record(
      {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: input.userId,
        action: action === 'ACCEPTED' ? 'legal.consent.accepted' : 'legal.consent.withdrawn',
        resourceType: 'legal_document',
        resourceId: document.id,
        reason: `${document.type} v${document.version} (${document.locale})`,
      },
      tx,
    );
  }
}
