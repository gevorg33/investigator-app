import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantMemberships, tenants } from './tenants';

/**
 * An agency's teams (T-086, tenancy.md §4): a name, what it is for, and its members. A member may
 * be in several. Teams will drive assignment staffing and `investigations.read` (T-089) and
 * notification routing (T-036); they grant nothing by themselves.
 *
 * Private to the workspace (row-level security, migration 0029).
 */
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // What team_members' composite key points at: a member joins a team of their own workspace.
    unique('teams_id_tenant_unique').on(t.id, t.tenantId),
    // Two teams of one agency are never called the same, whatever the case.
    uniqueIndex('teams_tenant_name_unique').on(t.tenantId, sql`lower(${t.name})`),
  ],
);

/**
 * Who is in which team. `tenant_id` is denormalised, and held equal to both the team's and the
 * membership's by composite keys — so a member of one agency can never be put in another's team,
 * whoever writes the row, and the policy compares a column rather than joining.
 */
export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'team_members_pk', columns: [t.teamId, t.membershipId] }),
    foreignKey({
      name: 'team_members_team_fk',
      columns: [t.teamId, t.tenantId],
      foreignColumns: [teams.id, teams.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'team_members_membership_fk',
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [tenantMemberships.id, tenantMemberships.tenantId],
    }).onDelete('cascade'),
    index('team_members_tenant_membership_idx').on(t.tenantId, t.membershipId),
  ],
);
