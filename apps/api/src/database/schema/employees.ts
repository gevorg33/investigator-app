import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { roles, tenantKind, tenants } from './tenants';
import { citext } from './types';
import { users } from './users';

/**
 * Where an invitation stands (T-085, tenancy.md §2). EXPIRED is not stored: it is a PENDING
 * invitation past `expires_at`, derived when read — nothing runs to set it, and a stored EXPIRED
 * would be wrong the moment the clock passed it.
 */
export const invitationStatus = pgEnum('invitation_status', ['PENDING', 'ACCEPTED', 'CANCELLED']);

/**
 * An invitation to join an agency (T-085): an email address, the one role it grants, and a
 * hashed single-use token. Accepting it is the moment a membership is created — or a removed one
 * comes back — and only the account with that address, confirmed, can do it.
 *
 * Its own workspace reads and writes it. The invitee reads their own pending invitation and marks
 * it accepted, through policies keyed on their account's email (migration 0028) — never on
 * anything the request says.
 */
export const tenantInvitations = pgTable(
  'tenant_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    /** Held to AGENCY: a Personal workspace has no one to invite (tenancy.md §3). */
    tenantKind: tenantKind('tenant_kind').notNull().default('AGENCY'),
    email: citext('email').notNull(),
    /** The one role the membership starts with; more can be assigned once it exists. */
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    /** The token's hash. The token itself is mailed and never stored, logged or audited. */
    tokenHash: text('token_hash').notNull(),
    status: invitationStatus('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'restrict' }),
    sentCount: integer('sent_count').notNull().default(1),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'tenant_invitations_tenant_fk',
      columns: [t.tenantId, t.tenantKind],
      foreignColumns: [tenants.id, tenants.kind],
    }).onDelete('cascade'),
    uniqueIndex('tenant_invitations_token_hash_unique').on(t.tokenHash),
    // One live invitation per address per agency: a second is a resend, not a new one.
    uniqueIndex('tenant_invitations_one_pending')
      .on(t.tenantId, t.email)
      .where(sql`${t.status} = 'PENDING'`),
    index('tenant_invitations_tenant_idx').on(t.tenantId, t.status, t.createdAt),
    // What the invitee's own policies look up by: their address, among pending invitations.
    index('tenant_invitations_invitee_idx')
      .on(t.email)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);
