import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const userTokenPurpose = pgEnum('user_token_purpose', [
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
]);

/**
 * Single-use, short-lived tokens for email verification and password reset.
 *
 * One table rather than two: the lifecycle is identical — issue, deliver out of band,
 * redeem once, expire — and the purpose column keeps them from being interchangeable.
 * A reset token presented to the verification endpoint matches no row for that purpose.
 *
 * Only the hash is stored, for the same reason as refresh tokens: a leaked table must
 * not be a set of usable password-reset links.
 */
export const userTokens = pgTable(
  'user_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: userTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Set the moment it is redeemed. Presence, not absence, is what makes it single-use.
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('user_tokens_hash_unique').on(t.tokenHash),
    // Issuing a new token invalidates the outstanding ones for that purpose, so the
    // lookup is always (user, purpose).
    index('user_tokens_user_purpose_idx').on(t.userId, t.purpose),
  ],
);
