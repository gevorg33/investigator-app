import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * What a legal hold can name (T-035). Each is a resource a retention rule eventually removes
 * (docs/compliance/retention.md). A kind is added by migration when the retention path that must
 * respect it arrives — evidence items with T-116 — so a hold never names something no path checks.
 */
export const legalHoldResource = pgEnum('legal_hold_resource', [
  /** A person's account and what retention removes with it. */
  'USER',
  /** A workspace — an agency, or someone's Personal workspace. */
  'TENANT',
  'MISSION',
  'ASSIGNMENT',
  /** One stored file: a verification document, a profile image, an agency's branding. */
  'MEDIA_ASSET',
]);

/**
 * Data that must not be deleted, whatever retention says (T-035): a preservation request, a
 * dispute, litigation, counsel's instruction. **Legal hold overrides retention** — every retention
 * deletion path asks `RetentionGuard` before removing a row, and `retention.static.spec.ts` holds
 * that for every delete in the API.
 *
 * A hold names one resource. Releasing it is a deliberate act with its own reason, and the row
 * keeps both: holds are never deleted and never rewritten — the only change the database allows is
 * filling the release, once (trigger `legal_hold_released_once`, migration 0041).
 *
 * Read and written by COMPLIANCE staff inside PlatformContext, and read by retention jobs running
 * as the system. Nobody else sees one: telling a subject their data is preserved can tip off the
 * subject of a law-enforcement request (docs/operations/law-enforcement-requests.md).
 *
 * **Survives account deletion.** Neither the resource nor the people are foreign keys: the hold
 * must outlast what it names and who placed it, or deleting an account would release it.
 */
export const legalHolds = pgTable(
  'legal_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceType: legalHoldResource('resource_type').notNull(),
    /** Deliberately not a foreign key — see above. Checked to exist when the hold is placed. */
    resourceId: uuid('resource_id').notNull(),
    /** Why the data is preserved: the request, the case, the instruction. Staff read it only. */
    reason: text('reason').notNull(),
    placedBy: uuid('placed_by').notNull(),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    /** All three are null while the hold is in force, and set together, once, on release. */
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedBy: uuid('released_by'),
    releaseReason: text('release_reason'),
  },
  (t) => [
    // Serves RetentionGuard.sweep() and LegalHoldService.list(resource): the holds in force on a
    // resource. Partial, because a retention job asks only about holds still in force.
    index('legal_holds_active_idx')
      .on(t.resourceType, t.resourceId)
      .where(sql`${t.releasedAt} IS NULL`),
    // Serves LegalHoldService.list(): newest first, across every resource.
    index('legal_holds_placed_idx').on(t.placedAt, t.id),
    check('legal_holds_reason_length', sql`length(btrim(${t.reason})) BETWEEN 1 AND 2000`),
    check(
      'legal_holds_release_complete',
      sql`(${t.releasedAt} IS NULL AND ${t.releasedBy} IS NULL AND ${t.releaseReason} IS NULL)
          OR (${t.releasedAt} IS NOT NULL AND ${t.releasedBy} IS NOT NULL
              AND length(btrim(${t.releaseReason})) BETWEEN 1 AND 2000)`,
    ),
    check(
      'legal_holds_release_after_placing',
      sql`${t.releasedAt} IS NULL OR ${t.releasedAt} >= ${t.placedAt}`,
    ),
  ],
);
