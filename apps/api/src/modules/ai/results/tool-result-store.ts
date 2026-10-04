import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { currentContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db } from '../../../database/database.module';
import { aiSessions, aiToolResults } from '../../../database/schema';

/** How many records of a stored result go in front of a model at once. */
export const RESULT_PAGE = 20;

/**
 * A stored result as the assistant sees it: which result, what it is, one page of it, and how to
 * ask for the next. Never the whole.
 */
export interface ResultRef {
  resultId: string;
  tool: string;
  total: number;
  summary: Record<string, unknown>;
  items: unknown[];
  /** The next page, or null at the end. Bound to this result: refused for any other. */
  cursor: string | null;
}

const encode = (resultId: string, offset: number) =>
  Buffer.from(JSON.stringify({ r: resultId, o: offset })).toString('base64url');

function decode(cursor: string, resultId: string): number {
  try {
    const { r, o } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      r?: unknown;
      o?: unknown;
    };
    if (r === resultId && Number.isInteger(o) && (o as number) >= 0) return o as number;
  } catch {
    // Falls through to the refusal: a cursor that is not ours is not a cursor.
  }
  throw AppError.validation([
    { field: 'cursor', code: 'INVALID', messageKey: 'error.validation.cursor.invalid' },
  ]);
}

/**
 * Tool results too large for a prompt (ADR-0006, `ai-session-context`, T-048).
 *
 * ```
 * tool → keep: the whole result, stored in the session → result_id + summary + first page + cursor
 *      → page: the next page, read in SQL — the rows are never all loaded to be sliced
 * ```
 *
 * A search returning 10,000 records contributes a summary and twenty of them; the model asks for
 * the next page, by cursor. Results are private as their session — its own user, in its own
 * workspace — written once, and erased with it. {@link forContext} is the only way one is rendered
 * for a model, and `tool-result-store.spec.ts` holds that nothing else reads the table.
 */
@Injectable()
export class ToolResultStore {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
  ) {}

  async keep(
    actor: Actor,
    sessionId: string,
    result: { tool: string; items: readonly unknown[]; summary: Record<string, unknown> },
    req: RequestContext,
  ): Promise<ResultRef> {
    const c = ctx('ai_tool_result.keep', req, sessionId);
    await this.enter(actor, c);
    const [session] = await this.db
      .select({ id: aiSessions.id })
      .from(aiSessions)
      .where(and(eq(aiSessions.id, sessionId), isNull(aiSessions.deletedAt)));
    await this.authz.visible(actor, session, c);
    const [row] = await this.db
      .insert(aiToolResults)
      .values({
        sessionId,
        tool: result.tool,
        summary: result.summary,
        items: [...result.items],
        total: result.items.length,
      })
      .returning({ id: aiToolResults.id });
    return this.page(actor, row!.id, undefined, req);
  }

  /** One page of a stored result, from the cursor (or the start). The caller's own, or a 404. */
  async page(
    actor: Actor,
    resultId: string,
    cursor: string | undefined,
    req: RequestContext,
  ): Promise<ResultRef> {
    const c = ctx('ai_tool_result.page', req, resultId);
    await this.enter(actor, c);
    const offset = cursor === undefined ? 0 : decode(cursor, resultId);
    const [row] = await this.db
      .select({
        tool: aiToolResults.tool,
        total: aiToolResults.total,
        summary: aiToolResults.summary,
        // Just this page, sliced by PostgreSQL: ordinality is 1-based.
        items: sql<unknown[]>`coalesce((
          SELECT jsonb_agg(e.value ORDER BY e.n)
            FROM jsonb_array_elements(${aiToolResults.items}) WITH ORDINALITY AS e(value, n)
           WHERE e.n > ${offset} AND e.n <= ${offset + RESULT_PAGE}), '[]'::jsonb)`,
      })
      .from(aiToolResults)
      .where(eq(aiToolResults.id, resultId));
    const found = await this.authz.visible(actor, row, c);
    const next = offset + RESULT_PAGE;
    return {
      resultId,
      tool: found.tool,
      total: found.total,
      summary: found.summary,
      items: found.items,
      cursor: next < found.total ? encode(resultId, next) : null,
    };
  }

  private async enter(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireWorkspace(actor, currentContext() !== undefined, c);
  }
}

/**
 * What of a stored result may be put in front of a model: the reference, the summary and one page,
 * at most {@link RESULT_PAGE} records — never more, whatever it is handed. The Context Builder
 * (T-046) renders tool results through this and nothing else.
 */
export function forContext(ref: ResultRef): string {
  return JSON.stringify({
    resultId: ref.resultId,
    tool: ref.tool,
    total: ref.total,
    summary: ref.summary,
    items: ref.items.slice(0, RESULT_PAGE),
    more: ref.cursor !== null,
    cursor: ref.cursor,
  });
}

const ctx = (action: string, req: RequestContext, resourceId: string): AuthzContext => ({
  action,
  resourceType: 'ai_tool_result',
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});
