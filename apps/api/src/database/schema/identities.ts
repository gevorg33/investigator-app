import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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

export const oauthIntent = pgEnum('oauth_intent', ['SIGN_IN', 'LINK']);

/**
 * One trip to a provider and back (T-062): what the callback must find to be believed, and — when
 * the identity has no account yet — the sign-up it is waiting to complete.
 *
 * Only hashes of the secrets are stored. `state` binds the callback to this row and, through the
 * cookie that carries it, to the browser that started it; the row makes it single-use
 * (`consumed_at`) and short-lived (`expires_at`). The PKCE verifier never reaches the database: it
 * travels in that httpOnly cookie. `nonce` is checked against the ID token.
 *
 * A first sign-in with an identity that has no account does not create one. It records who the
 * provider said this is and hands the browser a second secret (`signup_token_hash`): the account
 * is created only when that is presented with the required documents accepted — so no account
 * ever exists having agreed to nothing (legal-consent).
 *
 * Rows are short-lived and deleted a day after they lapse, when the next attempt starts.
 */
export const oauthAttempts = pgTable(
  'oauth_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: identityProvider('provider').notNull(),
    intent: oauthIntent('intent').notNull(),
    stateHash: text('state_hash').notNull(),
    nonceHash: text('nonce_hash').notNull(),
    /** LINK only: the signed-in account that asked. The callback carries no session to read. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** A path on the app, checked relative before it was stored. */
    returnTo: text('return_to').notNull().default('/'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Set by a callback whose identity has no account: the sign-up waiting on the documents. */
    signupTokenHash: text('signup_token_hash'),
    providerAccountId: text('provider_account_id'),
    providerEmail: text('provider_email'),
    signupExpiresAt: timestamp('signup_expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('oauth_attempts_state_unique').on(t.stateHash),
    uniqueIndex('oauth_attempts_signup_unique')
      .on(t.signupTokenHash)
      .where(sql`signup_token_hash IS NOT NULL`),
    // Serves the purge of lapsed attempts at each start.
    index('oauth_attempts_expires_idx').on(t.expiresAt),
    check('oauth_attempts_link_has_user', sql`(${t.intent} = 'LINK') = (${t.userId} IS NOT NULL)`),
    check(
      'oauth_attempts_signup_complete',
      sql`(${t.signupTokenHash} IS NULL) = (${t.providerAccountId} IS NULL)
          AND (${t.signupTokenHash} IS NULL) = (${t.signupExpiresAt} IS NULL)`,
    ),
  ],
);
