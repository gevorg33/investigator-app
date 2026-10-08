import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { currentContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db } from '../../../database/database.module';
import {
  aiMessages,
  aiPlanSteps,
  aiPlans,
  aiSessionEntities,
  aiSessionSummaries,
  aiSessions,
  type SessionEntityKind,
  type SessionEntityOrigin,
  type SummaryContent,
} from '../../../database/schema';
import type { MessageView } from '../../ai-sessions/ai-sessions.service';
import { CHAT_MODEL, type ChatModel } from '../chat-model';
import { forContext, ToolResultStore } from '../results/tool-result-store';
import { availableForContext, DEFAULT_BUDGET, estimateTokens, type ContextBudget } from './budget';
import { chooseHistory, type Rung } from './history';
import {
  renderConversation,
  renderEntity,
  renderMessage,
  renderPlan,
  renderSummary,
  type LivePlan,
} from './render';
import { parseSummary, rollupPrompt, spanPrompt, SUMMARY_PROMPT_VERSION } from './summary.prompt';

/** The newest messages a compaction leaves unsummarized: what was just said stays verbatim. */
export const KEEP_RECENT = 6;
/** Level-0 summaries that, once this many stand after the last roll-up, are rolled into one. */
export const ROLLUP_EVERY = 4;
/** At most this much of a span is summarised at once; the rest waits for the next compaction. */
export const SPAN_TOKENS = 6_000;
/** The most messages read for one call — the newest of them, however long the session. */
const READ_CAP = 400;
const STATE_CAP = 30;
/** Past any message: sequences are PostgreSQL `integer`, so a JS safe integer would overflow them. */
const AFTER_EVERY_MESSAGE = 2_147_483_647;

/** A plan that still matters to what the person says next: waiting for them, or under way. */
const LIVE = ['PROPOSED', 'CONFIRMED', 'EXECUTING'] as const;

export interface BuiltContext {
  /** The `<conversation>` block, or '' when there is nothing before the request. */
  text: string;
  rung: Rung;
  compactionDue: boolean;
  tokens: number;
  /** What the call had for context after its fixed parts. */
  available: number;
}

export interface EntityNote {
  kind: SessionEntityKind;
  entityId: string;
  origin: SessionEntityOrigin;
  status?: string | null;
}

/**
 * The one service that decides what of a conversation reaches a model (ADR-0006, T-046,
 * `ai-session-context`). The model never chooses what history it sees.
 *
 * ```
 * actor → live, in a workspace → the session, its own (RLS: its user, its workspace; 404 otherwise)
 *   → read, all of it scoped by session in SQL: live plans and their steps, structured state,
 *     summaries, the messages no summary covers, and older messages relevant to the request
 *   → tool results through the result store's authorized page and forContext only
 *   → budget (output reserved first) → the highest rung that fits → rendered as delimited data
 * ```
 *
 * **Permissions before assembly.** Every read is the caller's own session under row-level security
 * and an explicit session filter, before any ranking: semantic relevance never reaches another
 * session or another person. **Nothing here is authority:** a summary or a message that claims a
 * role grants nothing — authorization is decided by `AuthzService`, every call, never from context.
 * **Plans are read live** and are never compacted away: a plan waiting for confirmation or under
 * way is in every context, with the status the database holds now.
 */
@Injectable()
export class ContextBuilderService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly results: ToolResultStore,
    @Inject(CHAT_MODEL) private readonly model: ChatModel | null,
  ) {}

  /**
   * The context for one call in `sessionId`: everything before message `before` (the request
   * itself, already stored), fitted into what `system`, `request` and the caller's `material`
   * leave of the budget.
   */
  async build(
    actor: Actor,
    sessionId: string,
    input: {
      request: string;
      before: number;
      system: string;
      material?: number;
      budget?: ContextBudget;
    },
    req: RequestContext,
  ): Promise<BuiltContext> {
    const c = ctx('ai_context.build', req, sessionId);
    await this.own(actor, sessionId, c);
    const available = availableForContext(input.budget ?? DEFAULT_BUDGET, {
      system: input.system,
      request: input.request,
      ...(input.material === undefined ? {} : { material: input.material }),
    });

    const plans = (await this.livePlans(sessionId)).map(renderPlan);
    const state = (await this.state(sessionId)).map(renderEntity);
    const { summaries, coveredTo } = await this.summaries(sessionId);
    const messages = await this.unsummarized(sessionId, coveredTo, input.before);
    const shown = await this.toolResults(actor, messages, req);
    const relevant = await this.relevant(sessionId, input.request, input.before);

    // Pinned first: a plan and the state are in every context; history gets what they leave.
    const pinned = [...plans, ...state].reduce((n, t) => n + estimateTokens(t), 0);
    const choice = chooseHistory(
      {
        summaries: summaries.map(renderSummary),
        messages: messages.map((m) => renderMessage(m, shown)),
        relevant: relevant.map((m) => renderMessage(m, shown)),
      },
      Math.max(0, available - pinned),
    );
    return {
      text: renderConversation({
        plans,
        state,
        summaries: choice.summaries,
        retrieved: choice.retrieved,
        recent: choice.recent,
      }),
      rung: choice.rung,
      compactionDue: choice.compactionDue,
      tokens: pinned + choice.tokens,
      available,
    };
  }

  /**
   * Summarises what has grown too long to carry verbatim — proactively: only when the next call
   * shaped as `shape` would pass {@link COMPACT_AT} of its allowance, long before it overflows. The newest {@link KEEP_RECENT} messages stay as they are; the span before them
   * that no summary covers becomes the next level-0 version; {@link ROLLUP_EVERY} of those become a
   * level-1 roll-up. **No message is deleted** — the summary is how they reach a model, never a
   * replacement for the record. Returns the versions written.
   */
  async compact(
    actor: Actor,
    sessionId: string,
    shape: { system: string; material?: number; budget?: ContextBudget },
    req: RequestContext,
  ): Promise<number[]> {
    const c = ctx('ai_context.compact', req, sessionId);
    await this.own(actor, sessionId, c);
    if (this.model === null) return [];
    const model = this.model;
    const written: number[] = [];
    // Due when the next call of this shape would be: proactive, before anything overflows.
    const next = await this.build(
      actor,
      sessionId,
      { ...shape, request: '', before: AFTER_EVERY_MESSAGE },
      req,
    );
    if (!next.compactionDue) return [];

    const { summaries, coveredTo } = await this.summaries(sessionId);
    const after = await this.unsummarized(sessionId, coveredTo, AFTER_EVERY_MESSAGE);
    const span = takeSpan(after.slice(0, Math.max(0, after.length - KEEP_RECENT)));
    if (span.length > 0) {
      const shown = await this.toolResults(actor, span, req);
      const previous = summaries.at(-1)?.content ?? null;
      const prompt = spanPrompt(
        previous,
        span.map((m) => renderMessage(m, shown).text),
      );
      const content = parseSummary(await model.complete(prompt));
      if (content !== null) {
        written.push(
          await this.write(actor, c, sessionId, {
            level: 0,
            start: span[0]!.sequence,
            end: span.at(-1)!.sequence,
            content,
          }),
        );
      }
    }

    // Roll up: the last roll-up (if any) and the level-0 summaries after it, into one.
    const now = await this.summaries(sessionId);
    const level0 = now.summaries.filter((s) => s.level === 0);
    if (level0.length >= ROLLUP_EVERY) {
      const parts = now.summaries;
      const content = parseSummary(
        await model.complete(rollupPrompt(parts.map((s) => renderSummary(s).full.text))),
      );
      if (content !== null) {
        written.push(
          await this.write(actor, c, sessionId, {
            level: 1,
            start: parts[0]!.sourceSequenceStart,
            end: parts.at(-1)!.sourceSequenceEnd,
            content,
          }),
        );
      }
    }
    return written;
  }

  /**
   * Records what a turn mentioned, as columns: kind, id, how it came in, its status as seen, and the
   * turn. Seen again, it moves to the newer turn and status; it never moves from a stronger origin
   * to a weaker one (`user` > `shown` > `plan` > `result`), so a search result that repeats
   * something the person named does not demote it.
   */
  async note(
    actor: Actor,
    sessionId: string,
    sequence: number,
    refs: readonly EntityNote[],
    req: RequestContext,
  ): Promise<void> {
    const c = ctx('ai_context.note', req, sessionId);
    await this.own(actor, sessionId, c);
    if (refs.length === 0) return;
    const rank = (column: string) =>
      sql.raw(
        `CASE ${column} WHEN 'user' THEN 4 WHEN 'shown' THEN 3 WHEN 'plan' THEN 2 ELSE 1 END`,
      );
    await this.db
      .insert(aiSessionEntities)
      .values(
        refs.map((r) => ({
          sessionId,
          kind: r.kind,
          entityId: r.entityId,
          origin: r.origin,
          status: r.status ?? null,
          lastMentionedSequence: sequence,
        })),
      )
      .onConflictDoUpdate({
        target: [aiSessionEntities.sessionId, aiSessionEntities.kind, aiSessionEntities.entityId],
        set: {
          lastMentionedSequence: sql`greatest(${aiSessionEntities.lastMentionedSequence}, excluded.last_mentioned_sequence)`,
          status: sql`coalesce(excluded.status, ${aiSessionEntities.status})`,
          origin: sql`CASE WHEN ${rank('excluded.origin')} > ${rank('ai_session_entities.origin')} THEN excluded.origin ELSE ai_session_entities.origin END`,
          updatedAt: new Date(),
        },
      });
  }

  /** Live, in a workspace, and the session the caller's own — a stranger's is the same 404 as none. */
  private async own(actor: Actor, sessionId: string, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireWorkspace(actor, currentContext() !== undefined, c);
    const [session] = await this.db
      .select({ id: aiSessions.id })
      .from(aiSessions)
      .where(and(eq(aiSessions.id, sessionId), isNull(aiSessions.deletedAt)));
    await this.authz.visible(actor, session, c);
  }

  /** Plans waiting for their person or under way, as the database holds them now. */
  private async livePlans(sessionId: string): Promise<LivePlan[]> {
    const plans = await this.db
      .select()
      .from(aiPlans)
      .where(and(eq(aiPlans.sessionId, sessionId), inArray(aiPlans.status, [...LIVE])))
      .orderBy(asc(aiPlans.createdAt));
    if (plans.length === 0) return [];
    const steps = await this.db
      .select()
      .from(aiPlanSteps)
      .where(
        inArray(
          aiPlanSteps.planId,
          plans.map((p) => p.id),
        ),
      )
      .orderBy(asc(aiPlanSteps.ordinal));
    return plans.map((p) => ({
      id: p.id,
      status: p.status,
      confirmation: p.confirmationStatus,
      expiresAt: p.expiresAt,
      steps: steps
        .filter((s) => s.planId === p.id)
        .map((s) => ({
          ordinal: s.ordinal,
          tool: s.tool,
          arguments: s.arguments as Record<string, unknown>,
          status: s.status,
        })),
    }));
  }

  private async state(sessionId: string) {
    return this.db
      .select({
        kind: aiSessionEntities.kind,
        entityId: aiSessionEntities.entityId,
        origin: aiSessionEntities.origin,
        status: aiSessionEntities.status,
        lastMentionedSequence: aiSessionEntities.lastMentionedSequence,
      })
      .from(aiSessionEntities)
      .where(eq(aiSessionEntities.sessionId, sessionId))
      .orderBy(desc(aiSessionEntities.lastMentionedSequence), asc(aiSessionEntities.kind))
      .limit(STATE_CAP);
  }

  /**
   * The summaries that together cover the conversation from its start, coarsest first: the latest
   * roll-up, then each level-0 summary after it. `coveredTo` is the last sequence they cover.
   */
  private async summaries(sessionId: string) {
    const rows = await this.db
      .select()
      .from(aiSessionSummaries)
      .where(eq(aiSessionSummaries.sessionId, sessionId))
      .orderBy(asc(aiSessionSummaries.sourceSequenceEnd), asc(aiSessionSummaries.version));
    const rollup = rows.filter((r) => r.level === 1).at(-1);
    const from = rollup?.sourceSequenceEnd ?? 0;
    const summaries = [
      ...(rollup === undefined ? [] : [rollup]),
      ...rows.filter((r) => r.level === 0 && r.sourceSequenceStart > from),
    ];
    return { summaries, coveredTo: summaries.at(-1)?.sourceSequenceEnd ?? 0 };
  }

  /** Messages after `coveredTo` and before `before`, oldest first — the newest {@link READ_CAP}. */
  private async unsummarized(
    sessionId: string,
    coveredTo: number,
    before: number,
  ): Promise<MessageView[]> {
    const rows = await this.db
      .select()
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.sessionId, sessionId),
          gt(aiMessages.sequence, coveredTo),
          lt(aiMessages.sequence, before),
        ),
      )
      .orderBy(desc(aiMessages.sequence))
      .limit(READ_CAP);
    return rows.reverse().map(view);
  }

  /**
   * Earlier messages of this session that match the request, best first — PostgreSQL full text,
   * as session search (ADR-0001); the vector half is T-133's. The session filter is in the query
   * and row-level security under it: relevance is ranked only among what the caller may read.
   */
  private async relevant(
    sessionId: string,
    request: string,
    before: number,
  ): Promise<MessageView[]> {
    const query = sql`websearch_to_tsquery('simple', ${request})`;
    const rows = await this.db
      .select()
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.sessionId, sessionId),
          lt(aiMessages.sequence, before),
          sql`${aiMessages.contentSearch} @@ ${query}`,
        ),
      )
      .orderBy(sql`ts_rank(${aiMessages.contentSearch}, ${query}) DESC`, desc(aiMessages.sequence))
      .limit(20);
    return rows.map(view);
  }

  /** Each stored result a message references, rendered by forContext from an authorized page. */
  private async toolResults(
    actor: Actor,
    messages: readonly MessageView[],
    req: RequestContext,
  ): Promise<Map<string, string>> {
    const shown = new Map<string, string>();
    for (const m of messages) {
      if (m.kind !== 'TOOL_RESULT') continue;
      const resultId = (m.event as { resultId: string }).resultId;
      if (shown.has(resultId)) continue;
      try {
        shown.set(resultId, forContext(await this.results.page(actor, resultId, undefined, req)));
      } catch (e) {
        // Gone, or no longer the caller's: said as unavailable, never guessed at.
        if (!(e instanceof AppError)) throw e;
      }
    }
    return shown;
  }

  /** The next version, numbered under a lock on the session as messages are (T-045). */
  private async write(
    actor: Actor,
    c: AuthzContext,
    sessionId: string,
    s: { level: number; start: number; end: number; content: SummaryContent },
  ): Promise<number> {
    const model = this.model!;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM ai_sessions WHERE id = ${sessionId} FOR UPDATE`);
      const [{ next }] = (await tx.execute(sql`
        SELECT coalesce(max(version), 0) + 1 AS next
          FROM ai_session_summaries WHERE session_id = ${sessionId}`)) as unknown as [
        { next: number },
      ];
      await tx.insert(aiSessionSummaries).values({
        sessionId,
        version: next,
        level: s.level,
        sourceSequenceStart: s.start,
        sourceSequenceEnd: s.end,
        model: model.model,
        promptVersion: SUMMARY_PROMPT_VERSION,
        content: s.content,
      });
      // References, never content (`audit-logging`): which version, which span, which model.
      await this.audit.record(
        {
          correlationId: c.correlationId,
          actorId: actor.userId,
          action: 'ai_session.summarized',
          resourceType: 'ai_session',
          resourceId: sessionId,
          reason: `v${next} level ${s.level} ${s.start}-${s.end} (${model.model}, ${SUMMARY_PROMPT_VERSION})`,
          ipAddress: c.ipAddress,
        },
        tx,
      );
      return Number(next);
    });
  }
}

/** The oldest messages up to {@link SPAN_TOKENS}, at least one: a summary call stays bounded. */
function takeSpan(messages: readonly MessageView[]): MessageView[] {
  const span: MessageView[] = [];
  let used = 0;
  for (const m of messages) {
    const cost = estimateTokens(JSON.stringify([m.content, m.event, m.metadata]));
    if (span.length > 0 && used + cost > SPAN_TOKENS) break;
    span.push(m);
    used += cost;
  }
  return span;
}

const view = (r: typeof aiMessages.$inferSelect): MessageView => ({
  id: r.id,
  sequence: r.sequence,
  role: r.role,
  kind: r.kind,
  content: r.content,
  event: r.event,
  metadata: r.metadata,
  createdAt: r.createdAt.toISOString(),
});

const ctx = (action: string, req: RequestContext, sessionId: string): AuthzContext => ({
  action,
  resourceType: 'ai_session',
  resourceId: sessionId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});
