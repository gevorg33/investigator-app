import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { mediaAssets } from './media';
import { investigatorProfiles } from './profiles';

/**
 * SUBMITTED — waiting for a reviewer. At most one per profile, enforced by an index.
 * APPROVED  — a reviewer accepted the documents for what was declared.
 * REJECTED  — a reviewer did not, and said why in terms the applicant can act on.
 *
 * Decided requests are never reopened. "Rejection is not permanent. Correct what the reason
 * identifies and submit again" — a resubmission is a new request, so the trail keeps both.
 */
export const verificationRequestStatus = pgEnum('verification_request_status', [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
]);

/**
 * Whole-application outcomes only. Approving part of what was declared needs verification
 * tracked per specialty and area, which discovery and quoting would then have to honour — a
 * task of its own (see TODO), not an outcome this table can express honestly yet.
 */
export const verificationOutcome = pgEnum('verification_outcome', ['APPROVED', 'REJECTED']);

/**
 * What the investigator had declared when they applied.
 *
 * Snapshotted rather than read live, because "the mismatch between declaration and document is
 * the finding that matters most" (`kb-staff-verification-review`) — and a declaration that
 * changes under a reviewer mid-review cannot be checked against anything. References only:
 * taxonomy node ids and service-area labels, never geometry.
 */
export interface DeclaredScope {
  specialtyNodeIds: string[];
  serviceAreas: Array<{
    id: string;
    label: string;
    countryCode: string | null;
    region: string | null;
    city: string | null;
  }>;
}

/** An investigator's application to be verified (plan.md §23, "Investigator verification queue"). */
export const verificationRequests = pgTable(
  'verification_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // restrict: an application and the decision on it are the record of how someone came to be
    // verified. They go through the retention workflow, not as a side effect of a deletion.
    profileId: uuid('profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'restrict' }),
    status: verificationRequestStatus('status').notNull().default('SUBMITTED'),
    declaredScope: jsonb('declared_scope').$type<DeclaredScope>().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Incremented by every write. A decision that read an older version fails rather than overwrites. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Copied from the profile by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    tenantId: uuid('tenant_id').notNull().default(sql`app_current_tenant()`),
  },
  (t) => [
    // The queue: open requests, oldest first. An unreviewed application is an investigator
    // who cannot appear in discovery or quote, so age is the ordering that matters.
    index('verification_requests_queue_idx').on(t.status, t.submittedAt),
    index('verification_requests_profile_idx').on(t.profileId, t.submittedAt),
    // One open application per investigator. A second submission while one is waiting would
    // split a reviewer's attention across two copies of the same question.
    uniqueIndex('verification_requests_one_open_per_profile')
      .on(t.profileId)
      .where(sql`${t.status} = 'SUBMITTED'`),
    foreignKey({
      name: 'verification_requests_profile_tenant_fk',
      columns: [t.profileId, t.tenantId],
      foreignColumns: [investigatorProfiles.id, investigatorProfiles.tenantId],
    }).onDelete('restrict'),
    unique('verification_requests_id_tenant_unique').on(t.id, t.tenantId),
  ],
);

/**
 * The documents an application was made with. Fixed at submission: adding a document to a
 * request someone is already reviewing would change the evidence under their decision.
 */
export const verificationRequestDocuments = pgTable(
  'verification_request_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'restrict' }),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Copied from the request by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    tenantId: uuid('tenant_id').notNull().default(sql`app_current_tenant()`),
  },
  (t) => [
    uniqueIndex('verification_request_documents_unique').on(t.requestId, t.mediaAssetId),
    index('verification_request_documents_asset_idx').on(t.mediaAssetId),
    foreignKey({
      name: 'verification_documents_request_tenant_fk',
      columns: [t.requestId, t.tenantId],
      foreignColumns: [verificationRequests.id, verificationRequests.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'verification_documents_asset_tenant_fk',
      columns: [t.mediaAssetId, t.tenantId],
      foreignColumns: [mediaAssets.id, mediaAssets.tenantId],
    }).onDelete('restrict'),
  ],
);

/**
 * A reviewer's decision, with its reason. Append-only, and one per request.
 *
 * "Your decision is attributed to you permanently and is visible in any later dispute or
 * audit" — so the reviewer is recorded by id without a foreign key, as in `audit_logs`: the
 * attribution must survive the reviewer's account.
 */
export const verificationDecisions = pgTable(
  'verification_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'restrict' }),
    outcome: verificationOutcome('outcome').notNull(),
    /**
     * Written for the applicant, who is shown it. "A specific one the applicant can act on" —
     * required for approvals too, because a review nobody can later explain is not a review.
     */
    reason: text('reason').notNull(),
    decidedBy: uuid('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Copied from the request by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    tenantId: uuid('tenant_id').notNull().default(sql`app_current_tenant()`),
  },
  (t) => [
    // A request is decided once. Two reviewers acting at the same instant produce one decision
    // and one conflict, never two verdicts on the same evidence.
    uniqueIndex('verification_decisions_one_per_request').on(t.requestId),
    foreignKey({
      name: 'verification_decisions_request_tenant_fk',
      columns: [t.requestId, t.tenantId],
      foreignColumns: [verificationRequests.id, verificationRequests.tenantId],
    }).onDelete('restrict'),
  ],
);
