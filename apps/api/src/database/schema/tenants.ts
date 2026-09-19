import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Workspaces (ADR-0011, docs/architecture/tenancy.md §2).
 *
 * PERSONAL — exactly one per user, created by a database trigger in the same statement as the
 *            user (migration 0011), so no path that creates a user can forget it. Never has a
 *            second member.
 * AGENCY   — registered deliberately (T-083), and has employees.
 */
export const tenantKind = pgEnum('tenant_kind', ['PERSONAL', 'AGENCY']);

export const tenantStatus = pgEnum('tenant_status', [
  'CREATING',
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
  'DELETED',
]);

/** "Accepted" is the moment an invitation becomes a membership, not a state (tenancy.md §2). */
export const membershipStatus = pgEnum('membership_status', ['ACTIVE', 'SUSPENDED', 'REMOVED']);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: tenantKind('kind').notNull(),
    status: tenantStatus('status').notNull().default('CREATING'),
    /** Agencies only. A Personal workspace is shown as "Personal" and has no name of its own. */
    name: text('name'),
    /**
     * The user a PERSONAL workspace belongs to; null for an agency. Cascades: deleting a user —
     * which only the retention workflow does — takes their empty Personal workspace with them.
     * Anything the workspace holds restricts that delete, as it should.
     */
    personalOwnerId: uuid('personal_owner_id').references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one Personal workspace per user. "At least one" is the trigger's job.
    uniqueIndex('tenants_one_personal_per_user').on(t.personalOwnerId),
    // Target of the memberships' composite key, so a membership always knows its workspace's
    // kind without a join — which is what lets a partial index refuse a second Personal member.
    unique('tenants_id_kind_unique').on(t.id, t.kind),
    index('tenants_status_idx').on(t.kind, t.status),
  ],
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    /** Copied from the workspace and held equal by the composite foreign key. */
    tenantKind: tenantKind('tenant_kind').notNull(),
    /**
     * NO ACTION and DEFERRABLE INITIALLY DEFERRED (set by hand in migration 0011 — drizzle has no
     * syntax for it): checked at commit, after a user's Personal workspace and this membership
     * with it have cascaded away. An agency membership still blocks a user's deletion; the
     * retention workflow handles those deliberately.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'no action' }),
    status: membershipStatus('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'tenant_memberships_tenant_fk',
      columns: [t.tenantId, t.tenantKind],
      foreignColumns: [tenants.id, tenants.kind],
    }).onDelete('cascade'),
    // One membership per person per workspace; a removed member rejoining reactivates it.
    uniqueIndex('tenant_memberships_tenant_user_unique').on(t.tenantId, t.userId),
    // A Personal workspace never has a second member.
    uniqueIndex('tenant_memberships_one_per_personal')
      .on(t.tenantId)
      .where(sql`${t.tenantKind} = 'PERSONAL'`),
    index('tenant_memberships_user_idx').on(t.userId, t.status),
  ],
);

/**
 * The permission catalog, seeded by migration as data from tenancy.md §3 and read-only to the
 * application. Authorization checks permissions, never role names (T-078).
 */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
});

/**
 * System roles have no workspace and are immutable. Custom roles, later, belong to one
 * workspace — the column exists so that is an addition, not a migration of every reference.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('roles_system_key_unique')
      .on(t.key)
      .where(sql`${t.tenantId} IS NULL`),
    uniqueIndex('roles_tenant_key_unique').on(t.tenantId, t.key),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => tenantMemberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleId] }),
    index('membership_roles_role_idx').on(t.roleId),
  ],
);
