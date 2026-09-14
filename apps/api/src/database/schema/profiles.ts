import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { taxonomyNodes } from './taxonomy';
import { users } from './users';

/**
 * A customer's own details.
 *
 * Separate from `users` because the two answer different questions. `users` is the account —
 * how you sign in, what roles you hold. This is how you work as a customer, and one account
 * can hold both this and an investigator profile without either being the account itself
 * (plan.md:12).
 */
export const customerProfiles = pgTable(
  'customer_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Optional: a customer may be acting for an organisation rather than themselves. */
    organisationName: text('organisation_name'),
    /** Private. Never appears in a public projection — see profile.projection.ts. */
    contactPhone: text('contact_phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_profiles_user_unique').on(t.userId)],
);

export const pricingModel = pgEnum('pricing_model', ['HOURLY', 'FIXED_FEE', 'RETAINER', 'MIXED']);

/**
 * Whether the profile is discoverable at all.
 *
 * DRAFT is the default: a profile becomes visible to customers only when its owner decides
 * it is ready, not the moment the investigator role is activated. Verification is a separate
 * axis entirely (T-013) — published is not verified.
 */
export const profileVisibility = pgEnum('profile_visibility', ['DRAFT', 'PUBLISHED']);

export const investigatorProfiles = pgTable(
  'investigator_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    headline: text('headline'),
    bio: text('bio'),
    yearsExperience: smallint('years_experience'),
    pricingModel: pricingModel('pricing_model'),
    /**
     * Minor units — cents, luma — as an integer, never a float. A rate is money, and
     * binary floating point cannot represent most decimal amounts exactly.
     */
    hourlyRateMinor: integer('hourly_rate_minor'),
    /** ISO 4217. Meaningless without it: 5000 is not an amount. */
    currency: text('currency'),
    /** The investigator's own switch: are they taking work right now? */
    acceptingWork: boolean('accepting_work').notNull().default(false),
    visibility: profileVisibility('visibility').notNull().default('DRAFT'),
    /** Private. Contact happens through the platform; this is for staff and support. */
    contactPhone: text('contact_phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('investigator_profiles_user_unique').on(t.userId),
    // Discovery filters on both (plan.md §9), and only published profiles are ever listed.
    index('investigator_profiles_visibility_idx').on(t.visibility, t.acceptingWork),
  ],
);

export const languageProficiency = pgEnum('language_proficiency', [
  'BASIC',
  'CONVERSATIONAL',
  'FLUENT',
  'NATIVE',
]);

/**
 * Languages an investigator works in. A discovery filter (plan.md §9), and distinct from the
 * account's interface locale — working in Russian is not the same as reading the site in it.
 */
export const investigatorLanguages = pgTable(
  'investigator_languages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'cascade' }),
    /** ISO 639-1, lower case. Not the app's en/ru/hy set: an investigator may work in more. */
    languageCode: text('language_code').notNull(),
    proficiency: languageProficiency('proficiency').notNull(),
  },
  (t) => [
    uniqueIndex('investigator_languages_unique').on(t.profileId, t.languageCode),
    index('investigator_languages_code_idx').on(t.languageCode),
  ],
);

/**
 * The nodes an investigator practises in (ADR-0007).
 *
 * A node id, never free text. Matching is an exact join over ids rather than a mapping
 * between two vocabularies nobody owns, and prose must never be able to substitute for a
 * declared node.
 */
export const investigatorSpecialties = pgTable(
  'investigator_specialties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'cascade' }),
    // restrict, not cascade: a taxonomy node is deprecated rather than deleted, and a
    // profile's declared specialty must survive that.
    taxonomyNodeId: uuid('taxonomy_node_id')
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('investigator_specialties_unique').on(t.profileId, t.taxonomyNodeId),
    index('investigator_specialties_node_idx').on(t.taxonomyNodeId),
  ],
);

/**
 * A recurring weekly availability window.
 *
 * Minutes from midnight rather than a time column, because the arithmetic discovery needs —
 * does this window overlap that one — is integer comparison, and a window is interpreted in
 * the account's own timezone (`users.timezone`) rather than stored with one. Storing a wall
 * clock plus its zone keeps a Tuesday morning a Tuesday morning across daylight saving,
 * which an absolute instant does not.
 */
export const investigatorAvailability = pgTable(
  'investigator_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'cascade' }),
    /** 0 = Monday, matching ISO 8601, through 6 = Sunday. */
    dayOfWeek: smallint('day_of_week').notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
  },
  (t) => [index('investigator_availability_profile_idx').on(t.profileId)],
);
