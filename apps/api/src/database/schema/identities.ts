import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const identityProvider = pgEnum('identity_provider', ['GOOGLE']);

/**
 * External sign-in methods attached to an account. Present before the first provider
 * ships (T-062) on purpose: adding it afterwards means migrating live accounts, and the
 * shape of identity linking is hard to change once people depend on it.
 *
 * Password credentials stay on `users` — a password is a property of the account rather
 * than a third-party identity, and keeping it there means the reset and session rules do
 * not have to reason about two storage locations.
 *
 * Linking is never automatic on a matching email address. Anyone able to create an
 * account at a provider using an address they do not control would otherwise inherit the
 * account here. A link requires a verified address on both sides, or an explicit,
 * authenticated action by the account holder.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: identityProvider('provider').notNull(),
    /** The provider's stable identifier. Never the email: addresses at a provider change. */
    providerAccountId: text('provider_account_id').notNull(),
    /** The address the provider asserted, kept for support and audit, never for matching. */
    providerEmail: text('provider_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    // One provider account maps to exactly one user, so a second account cannot claim it.
    uniqueIndex('user_identities_provider_account_unique').on(t.provider, t.providerAccountId),
    // One link per provider per user: re-authenticating updates the row, never adds one.
    uniqueIndex('user_identities_user_provider_unique').on(t.userId, t.provider),
    index('user_identities_user_idx').on(t.userId),
  ],
);
