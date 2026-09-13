import { index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Mirrors the `StaffScope` union in @investigator/auth. Both lists are checked against
 * each other at compile time in common/authz/scopes.ts, so adding a scope to one without
 * the other fails the build; adding it here additionally needs a migration.
 */
export const staffScope = pgEnum('staff_scope', [
  'VERIFICATION',
  'MODERATION',
  'DISPUTES',
  'PAYMENTS',
  'TAXONOMY',
  'ENFORCEMENT',
]);

/**
 * Which areas a staff member may act in.
 *
 * A separate table rather than a column on `user_roles` because the authorization rule is
 * that `isStaff` is never sufficient — "a moderator is not a payments reviewer". Scopes
 * are granted one at a time, revoked one at a time, and each grant records who made it.
 *
 * Rows are kept after revocation rather than deleted: who could see payments last March
 * is a question a dispute or an incident review will ask.
 */
export const userStaffScopes = pgTable(
  'user_staff_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: staffScope('scope').notNull(),
    /** The staff member who granted it. Null only for the first administrator, seeded. */
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // One row per user per scope. Re-granting updates the row rather than stacking
    // grants, so "does this person hold PAYMENTS" is never a question about which row.
    uniqueIndex('user_staff_scopes_user_scope_unique').on(t.userId, t.scope),
    index('user_staff_scopes_user_idx').on(t.userId),
  ],
);
