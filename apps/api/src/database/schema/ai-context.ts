import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { aiSessions } from './ai-sessions';

/**
 * What a summary keeps of the span it covers (`ai-session-context`): the goal, the entities talked
 * about, what was decided, what constrains it, what was done and what is still to do, and where it
 * stands. Words for a model to read — never ids it may act on, and never authority: structured
 * state and the database hold those.
 */
export interface SummaryContent {
  goal: string | null;
  entities: string[];
  decisions: string[];
  constraints: string[];
  completed: string[];
  pending: string[];
  state: string | null;
}

/**
 * A summary of a span of a conversation (T-046, ADR-0006): a context aid, never the record. The
 * messages it covers stay in `ai_messages`; this is how they reach a model once they no longer fit.
 *
 * **Versioned and reproducible:** a number per session, the model and instructions that wrote it,
 * and the exact sequence range it covers. **Hierarchical:** level 0 summarises messages; level 1
 * summarises level-0 summaries, so thousands of messages are never re-read. Written once, never
 * changed, and erased with its session.
 */
export const aiSessionSummaries = pgTable(
  'ai_session_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'restrict' }),
    /** 1, 2, 3… per session, in the order they were written. */
    version: integer('version').notNull(),
    /** 0: of messages. 1: of level-0 summaries. */
    level: integer('level').notNull(),
    sourceSequenceStart: integer('source_sequence_start').notNull(),
    sourceSequenceEnd: integer('source_sequence_end').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    content: jsonb('content').$type<SummaryContent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`),
  },
  (t) => [
    unique('ai_session_summaries_version_unique').on(t.sessionId, t.version),
    // Serves the Context Builder: a session's summaries at a level, latest span first.
    index('ai_session_summaries_span_idx').on(t.sessionId, t.level, t.sourceSequenceEnd),
  ],
);

/** What an entity reference can point at. A new kind is a migration, as a new table is. */
export const SESSION_ENTITY_KINDS = [
  'mission',
  'assignment',
  'quote',
  'investigator_profile',
  'plan',
  'team',
  'invitation',
] as const;
export type SessionEntityKind = (typeof SESSION_ENTITY_KINDS)[number];

/**
 * How an entity came into the conversation — what T-216 needs to decide what "it" may mean: the
 * person's own turn; an output they were shown that names it; a list or search result (never a
 * referent); a plan proposed in the session.
 */
export const SESSION_ENTITY_ORIGINS = ['user', 'shown', 'result', 'plan'] as const;
export type SessionEntityOrigin = (typeof SESSION_ENTITY_ORIGINS)[number];

/**
 * Structured session state (T-046, review 2026-10-06): the entities a conversation is about, as
 * columns — kind, id, the status last seen, the turn that last mentioned it. Never sentences in a
 * summary. A status here is what was true when it was seen; anything that depends on it reads the
 * entity again, through row-level security and current authorization (`ai-session-context`).
 */
export const aiSessionEntities = pgTable(
  'ai_session_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'restrict' }),
    kind: text('kind').$type<SessionEntityKind>().notNull(),
    entityId: uuid('entity_id').notNull(),
    origin: text('origin').$type<SessionEntityOrigin>().notNull(),
    /** As last seen — an enum value such as `EXECUTING`, never prose. */
    status: text('status'),
    lastMentionedSequence: integer('last_mentioned_sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`),
  },
  (t) => [unique('ai_session_entities_ref_unique').on(t.sessionId, t.kind, t.entityId)],
);
