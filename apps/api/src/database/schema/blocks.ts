import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { investigatorProfiles } from './profiles';
import { tenants } from './tenants';
import { users } from './users';

/**
 * One person refusing future engagement with another (T-052). Between **people**, not
 * workspaces: an investigator blocked from their Personal workspace is blocked from their agency
 * too, since it is the person the blocker does not want to deal with.
 *
 * Private to the blocker — the blocked person cannot read the row, and nothing they are shown
 * changes shape because of it. What enforcement needs from it, it gets through
 * `app_blocked_users()` (migration 0034): the people blocked either way with the current user,
 * never who blocked whom. `tenant_id` records where the block was made; it does not scope it.
 *
 * A block governs what happens next. It never ends an assignment already under way — that goes to
 * staff (docs/architecture/blocks.md).
 */
export const userBlocks = pgTable(
  'user_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerId: uuid('blocker_id')
      .notNull()
      .default(sql`app_current_user()`)
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /**
     * The blocked person's investigator profile, when they had one at the time: how a customer's
     * list links to it, and how accepting that investigator's earlier quote is refused.
     */
    blockedProfileId: uuid('blocked_profile_id').references(() => investigatorProfiles.id, {
      onDelete: 'set null',
    }),
    /** Where the blocker was when they blocked: a profile, a mission or an assignment. */
    source: text('source').notNull(),
    /**
     * The name the blocker could already see when they blocked, so their list can say who it is.
     * None from a mission: a customer is anonymous to an investigator until hired.
     */
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_blocks_pair_unique').on(t.blockerId, t.blockedId),
    // The other direction: "who has blocked me", for the blocked set and staff's signal.
    index('user_blocks_blocked_idx').on(t.blockedId),
  ],
);
