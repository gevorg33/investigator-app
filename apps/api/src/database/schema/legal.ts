import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * What someone agreed to, in which language, and when (T-021, `legal-consent`).
 *
 * A consent record has to answer that years later, to a hostile reader. A boolean
 * `accepted_terms` column answers none of it, so there is no such column anywhere: consent is
 * per document, per version, and it carries a copy of the exact text's hash.
 */
export const legalDocumentType = pgEnum('legal_document_type', [
  'PRIVACY_POLICY',
  'TERMS_OF_SERVICE',
  'TERMS_AND_CONDITIONS',
  'LAWFUL_USE_POLICY',
  'INVESTIGATOR_AGREEMENT',
  'AGENCY_AGREEMENT',
]);

/** DRAFT is editable. Anything else is published, and published text never changes. */
export const legalDocumentStatus = pgEnum('legal_document_status', [
  'DRAFT',
  'CURRENT',
  'SUPERSEDED',
]);

/** Withdrawing appends; it never removes the acceptance that happened. */
export const consentAction = pgEnum('consent_action', ['ACCEPTED', 'WITHDRAWN']);

/** Where in the product this was given, which is part of what makes it evidence. */
export const consentContext = pgEnum('consent_context', [
  'REGISTRATION',
  'REACCEPTANCE',
  'ROLE_ACTIVATION',
  'AGENCY_CREATION',
]);

export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: legalDocumentType('type').notNull(),
    version: integer('version').notNull(),
    /** The language this text is written in — someone who read `hy` did not read `en`. */
    locale: text('locale').notNull(),
    title: text('title').notNull(),
    /** The rendered text itself, so what a person saw can be produced from one row. */
    content: text('content').notNull(),
    /**
     * SHA-256 of `content`, computed by the database on write. Never supplied by a caller: a
     * hash the writer chooses is a hash that can disagree with the text it claims to describe.
     */
    contentHash: text('content_hash').notNull(),
    status: legalDocumentStatus('status').notNull().default('DRAFT'),
    /** Exactly one locale per type and version governs; the others are translations of it. */
    isAuthoritativeLocale: boolean('is_authoritative_locale').notNull().default(false),
    /**
     * Whether this version obliges people who accepted the last one to accept again. A
     * compliance decision, set on the document and read by code — never inferred from a diff.
     */
    requiresReacceptance: boolean('requires_reacceptance').notNull().default(true),
    supersedesId: uuid('supersedes_id'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('legal_documents_version_locale_unique').on(t.type, t.version, t.locale),
    // One current version per type and locale: "the current terms in English" must name one row.
    uniqueIndex('legal_documents_one_current')
      .on(t.type, t.locale)
      .where(sql`status = 'CURRENT'`),
    // One authoritative locale per version, for the same reason.
    uniqueIndex('legal_documents_one_authoritative')
      .on(t.type, t.version)
      .where(sql`is_authoritative_locale`),
    index('legal_documents_lookup_idx').on(t.type, t.status, t.locale),
  ],
);

export const userConsents = pgTable(
  'user_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Deliberately not a foreign key. Consent outlives the account: deleting a user does not
     * delete the proof that they agreed to the terms their data was processed under, which is
     * often exactly what a regulator asks for (docs/compliance/retention.md).
     */
    userId: uuid('user_id').notNull(),
    legalDocumentId: uuid('legal_document_id')
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'restrict' }),
    /**
     * Copied at the moment of acceptance, not joined. If a document row were ever corrected, a
     * joined hash would change retroactively and the record would become a lie. The copy is the
     * evidence; the document is immutable so that the two can never disagree.
     */
    documentType: legalDocumentType('document_type').notNull(),
    documentVersion: integer('document_version').notNull(),
    contentHash: text('content_hash').notNull(),
    localeShown: text('locale_shown').notNull(),
    action: consentAction('action').notNull(),
    context: consentContext('context').notNull(),
    /**
     * Which workspace it was given in, filled by DEFAULT from the execution context (T-080).
     * Nullable: registration happens before any workspace exists. It records where the consent
     * was given — it is not what scopes the row, which belongs to a person.
     */
    tenantId: uuid('tenant_id').default(sql`app_current_tenant()`),
    /** An acceptance and a withdrawal are both things that happened at a time. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    correlationId: text('correlation_id'),
  },
  (t) => [
    // "What is true for this person and this document now" is the latest row for the pair.
    index('user_consents_user_document_idx').on(t.userId, t.documentType, t.occurredAt.desc()),
    index('user_consents_document_idx').on(t.legalDocumentId),
  ],
);
