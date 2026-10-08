import type { SummaryContent } from '../../../database/schema';
import type { MessageView } from '../../ai-sessions/ai-sessions.service';
import { escapeForPrompt } from '../knowledge-answer.prompt';
import { estimateTokens } from './budget';
import type { MessagePiece, SummaryPiece } from './history';

/**
 * Everything here puts conversation in front of a model as **data** (T-046): each piece in its own
 * delimiter, every value escaped with the knowledge prompt's escaping, so a message, a summary or a
 * tool result containing `</message>` — or "ignore your instructions" — cannot close its delimiter
 * or become one. Nothing rendered here is an instruction, and nothing in it is authority.
 */

const attr = (value: string | number) => `"${escapeForPrompt(String(value))}"`;

/** A plan as the database holds it now — read for this call, never remembered from an earlier one. */
export interface LivePlan {
  id: string;
  status: string;
  confirmation: string;
  expiresAt: Date;
  steps: Array<{
    ordinal: number;
    tool: string;
    arguments: Record<string, unknown>;
    status: string;
  }>;
}

export interface EntityRef {
  kind: string;
  entityId: string;
  origin: string;
  status: string | null;
  lastMentionedSequence: number;
}

export function renderPlan(plan: LivePlan): string {
  const steps = plan.steps.map(
    (s) =>
      `<step n=${attr(s.ordinal)} tool=${attr(s.tool)} status=${attr(s.status)}>` +
      `${escapeForPrompt(JSON.stringify(s.arguments))}</step>`,
  );
  return [
    `<plan id=${attr(plan.id)} status=${attr(plan.status)} confirmation=${attr(plan.confirmation)} expires=${attr(plan.expiresAt.toISOString())}>`,
    ...steps,
    '</plan>',
  ].join('\n');
}

export function renderEntity(e: EntityRef): string {
  return (
    `<entity kind=${attr(e.kind)} id=${attr(e.entityId)} origin=${attr(e.origin)}` +
    `${e.status === null ? '' : ` status=${attr(e.status)}`} last_mentioned=${attr(e.lastMentionedSequence)}/>`
  );
}

/** What a message said, in words a model can read — the reply's own words, or what it was. */
function said(m: MessageView, results: ReadonlyMap<string, string>): string {
  switch (m.kind) {
    case 'TOOL_CALL': {
      const event = m.event as { tool: string; arguments: unknown };
      return `called ${event.tool} with ${JSON.stringify(event.arguments)}`;
    }
    case 'TOOL_RESULT': {
      // Only through forContext, rendered by the caller from an authorized page (T-048).
      const resultId = (m.event as { resultId: string }).resultId;
      return results.get(resultId) ?? `result ${resultId} is not available`;
    }
    case 'PLAN_OUTCOME': {
      const event = m.event as { planId: string; outcome: string; reason?: string | null };
      return `plan ${event.planId} ended: ${event.outcome}${event.reason ? ` (${event.reason})` : ''}`;
    }
    case 'TEXT':
      if (m.content !== null && m.content !== '') return m.content;
      return describeReply(m.metadata);
  }
}

/** A reply stored without words of its own: what kind of reply it was. */
function describeReply(metadata: Record<string, unknown>): string {
  const meta = metadata as {
    source?: string;
    status?: string;
    answer?: { status?: string; results?: unknown[] };
  };
  switch (meta.source) {
    case 'discovery': {
      const status = meta.answer?.status ?? 'unknown';
      const shown = meta.answer?.results?.length ?? 0;
      return status === 'results'
        ? `showed ${shown} matching investigators`
        : `investigator search: ${status}`;
    }
    case 'knowledge':
      return 'the help articles do not cover this';
    case 'screen':
      return 'refused to read a message containing a credential';
    case 'routing':
      return 'pointed the person at the plan waiting for their confirmation';
    default:
      return '(no words)';
  }
}

export function renderMessage(m: MessageView, results: ReadonlyMap<string, string>): MessagePiece {
  const text =
    `<message seq=${attr(m.sequence)} role=${attr(m.role.toLowerCase())}>` +
    `${escapeForPrompt(said(m, results))}</message>`;
  return { sequence: m.sequence, text, tokens: estimateTokens(text) };
}

const list = (label: string, items: readonly string[]) =>
  items.length === 0 ? [] : [`${label}:`, ...items.map((i) => `- ${escapeForPrompt(i)}`)];
const line = (label: string, value: string | null) =>
  value === null ? [] : [`${label}: ${escapeForPrompt(value)}`];

export function renderSummary(s: {
  version: number;
  level: number;
  sourceSequenceStart: number;
  sourceSequenceEnd: number;
  content: SummaryContent;
}): SummaryPiece {
  const open = `<summary version=${attr(s.version)} level=${attr(s.level)} from=${attr(s.sourceSequenceStart)} to=${attr(s.sourceSequenceEnd)}>`;
  const c = s.content;
  const wrap = (lines: string[]) => {
    const text = [open, ...lines, '</summary>'].join('\n');
    return { text, tokens: estimateTokens(text) };
  };
  return {
    start: s.sourceSequenceStart,
    end: s.sourceSequenceEnd,
    full: wrap([
      ...line('Goal', c.goal),
      ...list('Entities', c.entities),
      ...list('Decisions', c.decisions),
      ...list('Constraints', c.constraints),
      ...list('Completed', c.completed),
      ...list('Pending', c.pending),
      ...line('State', c.state),
    ]),
    compact: wrap([
      ...line('Goal', c.goal),
      ...list('Decisions', c.decisions),
      ...list('Constraints', c.constraints),
      ...list('Pending', c.pending),
      ...line('State', c.state),
    ]),
    minimal: wrap([
      ...line('Goal', c.goal),
      ...list('Pending', c.pending),
      ...line('State', c.state),
    ]),
  };
}

/** The conversation block: each part only when it has something in it. */
export function renderConversation(parts: {
  plans: readonly string[];
  state: readonly string[];
  summaries: readonly string[];
  retrieved: readonly MessagePiece[];
  recent: readonly MessagePiece[];
}): string {
  const block = (tag: string, items: readonly string[]) =>
    items.length === 0 ? [] : [`<${tag}>`, ...items, `</${tag}>`];
  const lines = [
    ...block('plans', parts.plans),
    ...block('state', parts.state),
    ...block('summaries', parts.summaries),
    ...block(
      'earlier',
      parts.retrieved.map((m) => m.text),
    ),
    ...block(
      'recent',
      parts.recent.map((m) => m.text),
    ),
  ];
  return lines.length === 0 ? '' : ['<conversation>', ...lines, '</conversation>'].join('\n');
}
