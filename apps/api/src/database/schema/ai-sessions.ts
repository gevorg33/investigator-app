import { sql, type SQL } from 'drizzle-orm';
import {
  customType,
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
import { users } from './users';

/** A full-text vector, written by the database from the text it indexes. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * One conversation with the assistant (ADR-0006, T-045).
 *
 * **A session is not a context window.** It holds the whole conversation, which may run to tens
 * of thousands of messages; what reaches a model on any one call is chosen by the Context Builder
 * (T-046), never by trimming this.
 *
 * **One user, one workspace, for life.** Row-level security admits the session's own user, in
 * the session's own workspace, and nobody else — not an agency's owner, not a colleague. A
 * conversation with the assistant is as private as a draft.
 *
 * **Lifecycle is derived, not stored**: DELETED from `deleted_at`, ARCHIVED from `archived_at`,
 * IDLE from `last_activity_at`, ACTIVE otherwise. A stored IDLE would be wrong the moment a user
 * walked away, and nothing runs to correct it.
 *
 * **Deleted means erased.** The messages go in the same transaction and the title is cleared; the
 * row stays as a tombstone — whose it was and when it went — so the audit trail has something to
 * point at (owner decision, 2026-09-23).
 */
export const aiSessions = pgTable(
  'ai_sessions',
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
    /** Null until someone names it. Never generated from evidence content (T-045). */
    title: text('title'),
    /** The sequence the next message takes. Advanced under a row lock, so it never repeats. */
    nextSequence: integer('next_sequence').notNull().default(1),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    titleSearch: tsvector('title_search').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(${aiSessions.title}, ''))`,
    ),
  },
  (t) => [
    index('ai_sessions_owner_recent_idx').on(t.tenantId, t.userId, t.lastActivityAt),
    index('ai_sessions_title_search_idx').using('gin', t.titleSearch),
  ],
);

export const aiMessageRole = pgEnum('ai_message_role', ['USER', 'ASSISTANT', 'SYSTEM', 'TOOL']);

/**
 * What a message is. A tool call and its result are **structured events**, never prose (ADR-0006):
 * which tool, with what arguments, returning which stored result — so a later reader, human or
 * Context Builder, can tell exactly what was done rather than parse a sentence about it.
 */
export const aiMessageKind = pgEnum('ai_message_kind', ['TEXT', 'TOOL_CALL', 'TOOL_RESULT']);

/**
 * One message in a session, in order (T-045).
 *
 * Append-only: a trigger refuses any UPDATE, because the history is the source record the context
 * is built from, and a message that could be rewritten would make every summary of it unverifiable.
 * The only way a message leaves is with its whole session, when that session is deleted.
 */
export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    role: aiMessageRole('role').notNull(),
    kind: aiMessageKind('kind').notNull().default('TEXT'),
    /** The words, for TEXT. A tool event may carry a short description, or none. */
    content: text('content'),
    /** For TOOL_CALL `{ tool, arguments }`; for TOOL_RESULT `{ tool, resultId, ... }`. */
    event: jsonb('event').$type<Record<string, unknown>>(),
    /** Model, token counts, latency — anything about the message rather than in it. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Copied from the session by trigger, and never changed (T-076). */
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`),
    contentSearch: tsvector('content_search').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(${aiMessages.content}, ''))`,
    ),
  },
  (t) => [
    unique('ai_messages_session_sequence_unique').on(t.sessionId, t.sequence),
    index('ai_messages_content_search_idx').using('gin', t.contentSearch),
  ],
);
