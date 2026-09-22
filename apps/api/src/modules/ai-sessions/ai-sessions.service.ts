import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { currentContext } from '../../common/context/execution-context';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { aiMessages, aiSessions } from '../../database/schema';
import {
  clampLimit,
  decodeMessageCursor,
  decodeSessionCursor,
  encodeMessageCursor,
  encodeSessionCursor,
  statusOf,
  type SessionStatus,
} from './ai-sessions.policy';

type SessionRow = typeof aiSessions.$inferSelect;
type MessageRow = typeof aiMessages.$inferSelect;

export interface SessionView {
  id: string;
  title: string | null;
  status: SessionStatus;
  lastActivityAt: string;
  createdAt: string;
}

export interface MessageView {
  id: string;
  sequence: number;
  role: MessageRow['role'];
  kind: MessageRow['kind'];
  content: string | null;
  event: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/**
 * A message as the assistant appends it. The shapes mirror `ai_messages_shape`: words for TEXT,
 * and for a tool call or result a structured event — which tool, with what, returning which
 * stored result — never a sentence about it (ADR-0006).
 */
export type NewMessage =
  | {
      role: 'USER' | 'ASSISTANT' | 'SYSTEM';
      kind?: 'TEXT';
      content: string;
      metadata?: Record<string, unknown>;
    }
  | {
      role: 'ASSISTANT';
      kind: 'TOOL_CALL';
      event: { tool: string; arguments: Record<string, unknown> };
      content?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      role: 'TOOL';
      kind: 'TOOL_RESULT';
      event: { tool: string; resultId: string; [key: string]: unknown };
      content?: string;
      metadata?: Record<string, unknown>;
    };

/**
 * Every table that holds a session's content, erased with it in one transaction (T-045).
 *
 * Summaries (T-046), memory (T-047) and embeddings will join this list. They cannot be forgotten:
 * `ai-sessions.service.spec.ts` compares it with every foreign key the database has into
 * `ai_sessions`, and fails until a new one is here.
 */
export const SESSION_CONTENT: ReadonlyArray<{ table: PgTable; sessionId: PgColumn }> = [
  { table: aiMessages, sessionId: aiMessages.sessionId },
];

/**
 * Conversations with the assistant (ADR-0006, T-045).
 *
 * Every path is the caller's own: row-level security admits a session only to its user, in its
 * workspace, so a session that is someone else's — or in another of the caller's own workspaces —
 * is the same 404 as one that does not exist. The service adds what policy cannot: a workspace to
 * be in at all, a live account, and the lifecycle rules.
 *
 * Nothing here writes a title the user did not type. When titles are generated (T-056), they must
 * never carry evidence content.
 */
@Injectable()
export class AiSessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: Actor,
    input: { title?: string | undefined },
    req: RequestContext,
  ): Promise<SessionView> {
    const c = ctx('ai_session.create', req);
    await this.enter(actor, c);
    const [row] = await this.db
      .insert(aiSessions)
      .values({ title: input.title?.trim() ?? null, lastActivityAt: new Date() })
      .returning();
    await this.record(actor, c, 'ai_session.created', row!.id);
    return view(row!);
  }

  /** The caller's sessions in this workspace, most recently active first; archived ones on request. */
  async list(
    actor: Actor,
    query: { archived?: boolean; limit?: number | undefined; cursor?: string | undefined },
    req: RequestContext,
  ): Promise<Page<SessionView>> {
    const c = ctx('ai_session.list', req);
    await this.enter(actor, c);
    const archived = query.archived ?? false;
    const limit = clampLimit(query.limit);
    const after =
      query.cursor === undefined ? undefined : decodeSessionCursor(query.cursor, archived);

    const rows = await this.db
      .select()
      .from(aiSessions)
      .where(
        and(
          isNull(aiSessions.deletedAt),
          archived ? isNotNull(aiSessions.archivedAt) : isNull(aiSessions.archivedAt),
          after === undefined
            ? undefined
            : or(
                lt(aiSessions.lastActivityAt, after.lastActivityAt),
                and(
                  eq(aiSessions.lastActivityAt, after.lastActivityAt),
                  lt(aiSessions.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(aiSessions.lastActivityAt), desc(aiSessions.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => view(r)),
      pageInfo: {
        hasNextPage: rows.length > limit,
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeSessionCursor({ archived, lastActivityAt: last.lastActivityAt, id: last.id })
            : null,
      },
    };
  }

  async open(actor: Actor, sessionId: string, req: RequestContext): Promise<SessionView> {
    const c = ctx('ai_session.open', req, sessionId);
    await this.enter(actor, c);
    return view(await this.find(actor, sessionId, c));
  }

  /** Back to work: out of the archive if it was there, and active from now. */
  async resume(actor: Actor, sessionId: string, req: RequestContext): Promise<SessionView> {
    const c = ctx('ai_session.resume', req, sessionId);
    await this.enter(actor, c);
    await this.find(actor, sessionId, c);
    const now = new Date();
    const [row] = await this.db
      .update(aiSessions)
      .set({ archivedAt: null, lastActivityAt: now, updatedAt: now })
      .where(eq(aiSessions.id, sessionId))
      .returning();
    return view(row!, now);
  }

  /** The conversation in order, a page at a time, from the start or from where a page left off. */
  async messages(
    actor: Actor,
    sessionId: string,
    query: { limit?: number | undefined; cursor?: string | undefined },
    req: RequestContext,
  ): Promise<Page<MessageView>> {
    const c = ctx('ai_session.messages', req, sessionId);
    await this.enter(actor, c);
    await this.find(actor, sessionId, c);
    const limit = clampLimit(query.limit);
    const after = query.cursor === undefined ? 0 : decodeMessageCursor(query.cursor);

    const rows = await this.db
      .select()
      .from(aiMessages)
      .where(and(eq(aiMessages.sessionId, sessionId), gt(aiMessages.sequence, after)))
      .orderBy(asc(aiMessages.sequence))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(messageView),
      pageInfo: {
        hasNextPage: rows.length > limit,
        nextCursor:
          rows.length > limit && last !== undefined ? encodeMessageCursor(last.sequence) : null,
      },
    };
  }

  async rename(
    actor: Actor,
    sessionId: string,
    title: string,
    req: RequestContext,
  ): Promise<SessionView> {
    const c = ctx('ai_session.rename', req, sessionId);
    await this.enter(actor, c);
    await this.find(actor, sessionId, c);
    const [row] = await this.db
      .update(aiSessions)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(eq(aiSessions.id, sessionId))
      .returning();
    // The fact of the rename, not the title: a title is the user's words about their own work.
    await this.record(actor, c, 'ai_session.renamed', sessionId);
    return view(row!);
  }

  async archive(actor: Actor, sessionId: string, req: RequestContext): Promise<SessionView> {
    const c = ctx('ai_session.archive', req, sessionId);
    await this.enter(actor, c);
    const session = await this.find(actor, sessionId, c);
    if (session.archivedAt !== null) return view(session);
    const now = new Date();
    const [row] = await this.db
      .update(aiSessions)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(aiSessions.id, sessionId))
      .returning();
    await this.record(actor, c, 'ai_session.archived', sessionId);
    return view(row!);
  }

  /**
   * Erases the conversation and keeps the fact of it (owner decision, 2026-09-23).
   *
   * One transaction: every table in {@link SESSION_CONTENT} loses the session's rows, and the
   * session becomes a tombstone — no title, a deletion time, its owner. After this there is no
   * content left anywhere to read, and a trigger keeps the tombstone empty.
   */
  async delete(actor: Actor, sessionId: string, req: RequestContext): Promise<void> {
    const c = ctx('ai_session.delete', req, sessionId);
    await this.enter(actor, c);

    await this.db.transaction(async (tx) => {
      await this.find(actor, sessionId, c, tx, true);
      let erased = 0;
      for (const { table, sessionId: column } of SESSION_CONTENT) {
        erased += (await tx.delete(table).where(eq(column, sessionId)).returning()).length;
      }
      const now = new Date();
      await tx
        .update(aiSessions)
        .set({ title: null, archivedAt: null, deletedAt: now, updatedAt: now })
        .where(eq(aiSessions.id, sessionId));
      await this.record(actor, c, 'ai_session.deleted', sessionId, `${erased} rows erased`, tx);
    });
  }

  /**
   * The caller's sessions whose title or messages match, best first (PostgreSQL full-text,
   * ADR-0001). The `simple` configuration, because Armenian has no stemmer and one configuration
   * has to serve three languages; `websearch_to_tsquery`, because it parses anything a person
   * types without a syntax error. The vector half of hybrid search is T-133's.
   */
  async search(
    actor: Actor,
    q: string,
    req: RequestContext,
  ): Promise<Array<SessionView & { firstMatchSequence: number | null }>> {
    const c = ctx('ai_session.search', req);
    await this.enter(actor, c);

    const hits = (await this.db.execute(sql`
      SELECT s.id,
             greatest(ts_rank(s.title_search, q.query),
                      coalesce(max(ts_rank(m.content_search, q.query)), 0)) AS rank,
             min(m.sequence) AS first_match
        FROM ai_sessions s
       CROSS JOIN (SELECT websearch_to_tsquery('simple', ${q.trim()}) AS query) q
        LEFT JOIN ai_messages m ON m.session_id = s.id AND m.content_search @@ q.query
       WHERE s.deleted_at IS NULL
         AND (s.title_search @@ q.query OR m.id IS NOT NULL)
       GROUP BY s.id, s.title_search, q.query
       ORDER BY rank DESC, s.id
       LIMIT 20`)) as unknown as Array<{ id: string; first_match: number | null }>;
    if (hits.length === 0) return [];

    const rows = await this.db
      .select()
      .from(aiSessions)
      .where(
        inArray(
          aiSessions.id,
          hits.map((h) => h.id),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return hits.map((h) => ({ ...view(byId.get(h.id)!), firstMatchSequence: h.first_match }));
  }

  /**
   * Adds a message at the end of the conversation. For the assistant itself (T-056), not a route:
   * a user's words reach a session through the assistant, which records its own reply and tool
   * events beside them.
   *
   * The session row is locked while its next sequence is taken, so two messages arriving together
   * are numbered one after the other rather than colliding. A message to an archived session
   * brings it back; a deleted session takes none.
   */
  async append(
    actor: Actor,
    sessionId: string,
    message: NewMessage,
    req: RequestContext,
  ): Promise<MessageView> {
    const c = ctx('ai_session.append', req, sessionId);
    await this.enter(actor, c);

    return this.db.transaction(async (tx) => {
      const session = await this.find(actor, sessionId, c, tx, true);
      const now = new Date();
      const [row] = await tx
        .insert(aiMessages)
        .values({
          sessionId,
          sequence: session.nextSequence,
          role: message.role,
          kind: message.kind ?? 'TEXT',
          content: message.content ?? null,
          event: 'event' in message ? message.event : null,
          metadata: message.metadata ?? {},
        })
        .returning();
      await tx
        .update(aiSessions)
        .set({
          nextSequence: session.nextSequence + 1,
          lastActivityAt: now,
          archivedAt: null,
          updatedAt: now,
        })
        .where(eq(aiSessions.id, sessionId));
      return messageView(row!);
    });
  }

  /** A live account, in a workspace: a session belongs to exactly one, so there must be one. */
  private async enter(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireWorkspace(actor, currentContext() !== undefined, c);
  }

  /**
   * The caller's live session, or the 404 an unknown id gets. Row-level security has already
   * narrowed the table to the caller's own sessions in this workspace; a deleted one is gone too.
   */
  private async find(
    actor: Actor,
    sessionId: string,
    c: AuthzContext,
    tx?: Tx,
    lock = false,
  ): Promise<SessionRow> {
    const query = (tx ?? this.db)
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.id, sessionId), isNull(aiSessions.deletedAt)));
    const [row] = await (lock ? query.for('update') : query);
    return this.authz.visible(actor, row, c);
  }

  private async record(
    actor: Actor,
    c: AuthzContext,
    action: string,
    sessionId: string,
    reason?: string,
    tx?: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        action,
        resourceType: 'ai_session',
        resourceId: sessionId,
        reason,
      },
      tx,
    );
  }
}

const ctx = (action: string, req: RequestContext, resourceId?: string): AuthzContext => ({
  action,
  resourceType: 'ai_session',
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

const view = (s: SessionRow, now?: Date): SessionView => ({
  id: s.id,
  title: s.title,
  status: statusOf(s, now),
  lastActivityAt: s.lastActivityAt.toISOString(),
  createdAt: s.createdAt.toISOString(),
});

const messageView = (m: MessageRow): MessageView => ({
  id: m.id,
  sequence: m.sequence,
  role: m.role,
  kind: m.kind,
  content: m.content,
  event: m.event ?? null,
  metadata: m.metadata,
  createdAt: m.createdAt.toISOString(),
});
