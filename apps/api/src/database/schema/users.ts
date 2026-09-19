import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// A lazy reference: tenants.ts imports users too, and drizzle resolves both callbacks later.
import { tenants } from './tenants';
import { citext } from './types';

export const accountStatus = pgEnum('account_status', [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DELETED',
]);

export const userRoleName = pgEnum('user_role_name', ['CUSTOMER', 'INVESTIGATOR', 'STAFF']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // citext: uniqueness must be case-insensitive, or Bob@x.com and bob@x.com
    // become two accounts and account recovery gets ambiguous.
    email: citext('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    displayName: text('display_name'),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('UTC'),
    status: accountStatus('status').notNull().default('PENDING_VERIFICATION'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft delete: financial and evidence obligations outlive the account (T-035).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    // Partial: almost every query filters out deleted rows, so the index need not
    // carry them.
    index('users_status_idx')
      .on(t.status)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      // Roles are meaningless without their user; safe to cascade.
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRoleName('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('user_roles_user_role_unique').on(t.userId, t.role)],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Hash, never the token. A leaked session table must not be a leaked session.
    refreshTokenHash: text('refresh_token_hash').notNull(),
    // Reuse detection: rotation replaces a token, and presenting a replaced one
    // means it leaked — revoke the whole family (T-005).
    familyId: uuid('family_id').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * The workspace a request uses when it names none (tenancy.md §6). Set to the Personal
     * workspace at sign-in and carried through rotation; switching workspace updates it (T-075).
     * A preference, never an authority: the resolver re-reads memberships on every request.
     */
    defaultTenantId: uuid('default_tenant_id').references((): AnyPgColumn => tenants.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('user_sessions_refresh_hash_unique').on(t.refreshTokenHash),
    index('user_sessions_user_idx').on(t.userId),
    index('user_sessions_family_idx').on(t.familyId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
  sessions: many(userSessions),
}));
