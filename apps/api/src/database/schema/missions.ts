import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { riskBand, taxonomyNodes } from './taxonomy';
import { geographyPoint } from './types';
import { users } from './users';

/**
 * plan.md §8. The legal moves between these live in one place — the transition map in
 * modules/missions/mission-transitions.ts — and nothing else writes this column.
 */
export const missionStatus = pgEnum('mission_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'QUOTED',
  'CUSTOMER_CONFIRMED',
  'PAID',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'REPORT_SUBMITTED',
  'CUSTOMER_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'DISPUTED',
  'SUSPENDED',
  'EXPIRED',
]);

/**
 * Who the customer is to the subject of the work. Standing, not technique, decides whether a
 * request is supportable (docs/knowledge-base/policies/prohibited-requests.en.md), so the
 * moderator needs it stated in a form screening can act on deterministically.
 */
export const subjectRelationship = pgEnum('subject_relationship', [
  'SELF_OR_OWN_ORGANISATION',
  'EMPLOYER',
  'BUSINESS_RELATIONSHIP',
  'LEGAL_REPRESENTATIVE',
  'FAMILY_MEMBER',
  'PARTNER_OR_SPOUSE',
  'FORMER_PARTNER',
  'NO_PERSONAL_RELATIONSHIP',
  'OTHER',
]);

/** Who performed a transition. SYSTEM has no user; STAFF records the scope it acted under. */
export const missionActorKind = pgEnum('mission_actor_kind', [
  'CUSTOMER',
  'INVESTIGATOR',
  'STAFF',
  'SYSTEM',
]);

/**
 * A customer's description of work they need done.
 *
 * Every content field is nullable because a draft is saved incrementally. What a submitted
 * mission must contain is enforced twice: by the service, which reports usable field errors,
 * and by a CHECK in migration 0007, which holds against every writer.
 */
export const missions = pgTable(
  'missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // restrict: a mission carries history, quotes and money later. It goes through the
    // retention workflow, never as a side effect of deleting an account.
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: missionStatus('status').notNull().default('DRAFT'),
    /** Incremented by every write. A write that read an older version fails rather than overwrites. */
    version: integer('version').notNull().default(1),

    /** The taxonomy node the work falls under (ADR-0007). A node id, never free text. */
    taxonomyNodeId: uuid('taxonomy_node_id').references(() => taxonomyNodes.id, {
      onDelete: 'restrict',
    }),
    title: text('title'),
    description: text('description'),

    /** ISO 3166-1 alpha-2: the jurisdiction the work happens in. */
    countryCode: text('country_code'),
    locationLabel: text('location_label'),
    /**
     * Coarsened to two decimal places — about a kilometre — like a service-area centre. A
     * mission's location is often where its subject lives.
     */
    location: geographyPoint('location'),

    startBy: date('start_by', { mode: 'string' }),
    deadline: date('deadline', { mode: 'string' }),

    /** Minor units, as integers: money is never a float. */
    budgetMinMinor: integer('budget_min_minor'),
    budgetMaxMinor: integer('budget_max_minor'),
    /** ISO 4217. */
    currency: text('currency'),
    /** ISO 639-1 codes the investigator must work and report in. */
    languages: text('languages').array().notNull().default([]),

    /** The customer's own statement of why they need this — the decision it supports. */
    purpose: text('purpose'),
    subjectRelationship: subjectRelationship('subject_relationship'),
    /**
     * Whether a protective order or similar restriction exists between the customer and the
     * subject. Asked when the relationship is personal; null otherwise.
     */
    protectiveOrderDeclared: boolean('protective_order_declared'),

    /**
     * When the customer confirmed the request is for a lawful purpose. Required to leave DRAFT
     * and cleared when a mission returns to DRAFT, so every submission is confirmed afresh.
     */
    lawfulPurposeConfirmedAt: timestamp('lawful_purpose_confirmed_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /**
     * When the mission last became visible to investigators — entered QUOTED (T-054). Set by the
     * database (trigger `missions_published_at`) on every entry into QUOTED, so no writer can
     * forget it or back-date it; kept afterwards, so a hired mission still says when it was posted.
     */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The customer's workspace (T-076). Filled from the execution context, else from the
     * owning user's Personal workspace (trigger `fill_owner_tenant`); never changes after insert.
     */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('missions_customer_idx').on(t.customerId, t.createdAt),
    // The moderation queue lists by status, oldest submission first (T-051).
    index('missions_status_idx').on(t.status, t.submittedAt),
    index('missions_taxonomy_node_idx').on(t.taxonomyNodeId),
    unique('missions_id_customer_tenant_unique').on(t.id, t.customerTenantId),
    index('missions_customer_tenant_idx').on(t.customerTenantId, t.status),
    // Investigator browse (T-054): the published set, newest first.
    index('missions_published_idx')
      .on(t.publishedAt, t.id)
      .where(sql`${t.status} = 'QUOTED'`),
    // Distance filters use ST_DWithin, which needs a spatial index to avoid a scan.
    index('missions_location_gist')
      .using('gist', t.location)
      .where(sql`${t.status} = 'QUOTED'`),
  ],
);

/**
 * A browse an investigator saved, to run again without rebuilding it (T-054).
 *
 * **One user, one workspace**, like an assistant conversation: row-level security admits the
 * saving user in the workspace they saved it in, and nobody else. `filters` holds the browse
 * request's filters and sort as the API validated them — never a cursor or a limit — and is
 * validated again every time it is run, so a saved search can never do what a fresh one could not.
 */
export const savedMissionSearches = pgTable(
  'saved_mission_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`)
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('saved_mission_searches_owner_idx').on(t.tenantId, t.userId, t.createdAt),
    unique('saved_mission_searches_owner_name_unique').on(t.tenantId, t.userId, t.name),
  ],
);

/**
 * Every status a mission has held, who moved it, and why. Append-only by grant.
 *
 * A status without its history makes a dispute unresolvable: "it was cancelled" is not an
 * answer to "who cancelled it, from what, and when".
 */
export const missionStatusHistory = pgTable(
  'mission_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'restrict' }),
    /** Null only for the row recording creation. */
    fromStatus: missionStatus('from_status'),
    toStatus: missionStatus('to_status').notNull(),
    actorKind: missionActorKind('actor_kind').notNull(),
    // Deliberately not a foreign key, as in audit_logs: history outlives the account.
    actorId: uuid('actor_id'),
    staffScope: text('staff_scope'),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The order the moves were written in. `occurred_at` is its transaction's start time, so moves
     * in one transaction tie and a wall-clock step can put a later move first (T-155): "the latest
     * move" is the highest `seq`, never the latest time.
     */
    seq: bigint('seq', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    /**
     * Copied from the mission by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    // Serves OwnMissionRepository.reviewsOf(): the latest move per mission.
    index('mission_status_history_mission_seq_idx').on(t.missionId, t.seq),
    foreignKey({
      name: 'mission_status_history_mission_tenant_fk',
      columns: [t.missionId, t.customerTenantId],
      foreignColumns: [missions.id, missions.customerTenantId],
    }).onDelete('restrict'),
  ],
);

/**
 * PRIORITY_REVIEW — something about the mission needs a moderator's attention first: a
 * high or restricted band, a declared personal relationship, or a policy rule matched.
 * ROUTINE_REVIEW  — nothing tripped. Still reviewed: a clean screen is not an approval.
 *
 * There is no outcome that publishes or rejects. Both are a moderator's decision (T-051).
 */
export const missionScreeningOutcome = pgEnum('mission_screening_outcome', [
  'ROUTINE_REVIEW',
  'PRIORITY_REVIEW',
]);

/**
 * The automatic screening decision for one submission, and its reasons. Append-only.
 *
 * One row per submission, tied to the mission version it screened: a mission returned for
 * changes and resubmitted is screened again, and both results stay on record.
 */
export const missionScreenings = pgTable(
  'mission_screenings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'restrict' }),
    missionVersion: integer('mission_version').notNull(),
    /** Which ruleset produced this. A result is only explainable against the rules that made it. */
    rulesetVersion: text('ruleset_version').notNull(),
    outcome: missionScreeningOutcome('outcome').notNull(),
    riskBand: riskBand('risk_band').notNull(),
    /** Rule ids that matched. Staff-only: the customer is told the policy position, never the detection. */
    flags: jsonb('flags').$type<string[]>().notNull(),
    /**
     * An AI classification, when one exists, kept as labelled input for the moderator. It is
     * stored beside the decision and never feeds it — proven in mission-screening.spec.ts.
     */
    aiClassification: jsonb('ai_classification'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Copied from the mission by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    index('mission_screenings_mission_idx').on(t.missionId, t.createdAt),
    foreignKey({
      name: 'mission_screenings_mission_tenant_fk',
      columns: [t.missionId, t.customerTenantId],
      foreignColumns: [missions.id, missions.customerTenantId],
    }).onDelete('restrict'),
  ],
);
