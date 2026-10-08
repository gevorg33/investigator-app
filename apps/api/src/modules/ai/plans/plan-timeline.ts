import type { aiPlanSteps, aiPlans, auditLogs } from '../../../database/schema';

type PlanRow = typeof aiPlans.$inferSelect;
type StepRow = typeof aiPlanSteps.$inferSelect;
type AuditRow = Pick<
  typeof auditLogs.$inferSelect,
  'occurredAt' | 'action' | 'reason' | 'correlationId' | 'resourceType'
>;

/** How a plan ended, as its PLAN_OUTCOME message says (migration 0045). Null while it has not. */
export type Outcome = 'completed' | 'partial' | 'failed' | 'not_run' | 'declined';

/** A plan's own lifecycle in audit: what the timeline shows of it, and nothing else. */
export const PLAN_ACTIONS = [
  'ai_plan.proposed',
  'ai_plan.confirmed',
  'ai_plan.declined',
  'ai_plan.invalidated',
  'ai_plan.failed',
  'ai_plan.completed',
] as const;

/** What the plan's own rows say happened, in the order it happened. */
export type TimelineEvent =
  | { at: string; type: 'proposed'; steps: number }
  | { at: string; type: 'confirmed'; role: string | null }
  | { at: string; type: 'step_started'; ordinal: number; tool: string }
  | {
      at: string;
      type: 'step_finished';
      ordinal: number;
      tool: string;
      status: 'DONE' | 'FAILED' | 'SKIPPED';
      error: string | null;
    }
  | {
      at: string;
      type: 'ended';
      status: PlanRow['status'];
      confirmation: PlanRow['confirmationStatus'];
      reason: string | null;
    };

/** One audit row about the plan, as its person may read it. */
export interface AuditEntry {
  at: string;
  action: string;
  /** A code: a plan row's reason, or a tool call's first word (`ok`, `rejected`) — never arguments. */
  outcome: string | null;
  correlationId: string | null;
}

export interface PlanTimeline {
  planId: string;
  sessionId: string;
  status: PlanRow['status'];
  outcome: Outcome | null;
  /** The confirming request's id (T-212): the confirmation, every step's tool call and the end share it. */
  correlationId: string | null;
  /** A step left RUNNING when its plan ended: it may have taken effect, and its result is unknown. */
  unknown: number[];
  /** In the order things happened: proposed, confirmed, each step by ordinal, ended. */
  events: TimelineEvent[];
  /** In the order the database recorded them. */
  audit: AuditEntry[];
}

/**
 * What a tool call's audit reason may show: its first word. The rest is the arguments' shape. Only
 * calls with a reason are read (`ok: confirmed: …`, `rejected: …` — `AiPlansService.timeline`).
 */
const codeOf = (row: AuditRow): string | null =>
  row.resourceType === 'assistant_tool' ? row.reason!.split(':')[0]! : row.reason;

/**
 * One plan from proposal to its last step (T-214, P-3b), as a read model over the rows that hold
 * it: the plan and its steps say what happened, its audit rows say when and under which request.
 *
 * **Ordered by what caused what, not by clock.** A plan's creation is stamped by the database and its
 * progress by the API and the worker, whose clocks need not agree to the millisecond — in development
 * the database ran 50–250 ms ahead, which put "ended" before "proposed". The rows have an order of
 * their own: proposed, confirmed, the steps one after another, ended. The audit rows, all stamped by
 * the database, are a list of their own in time order.
 *
 * A step's status is the row's — a FAILED step is never shown as done — and how the plan ended is the
 * outcome the database wrote from those rows when it ended, so the timeline and the conversation never
 * disagree.
 */
export function buildTimeline(
  plan: PlanRow,
  steps: readonly StepRow[],
  audits: readonly AuditRow[],
  outcome: Outcome | null,
  correlationId: string | null,
): PlanTimeline {
  const at = (d: Date) => d.toISOString();
  const events: TimelineEvent[] = [
    { at: at(plan.createdAt), type: 'proposed', steps: steps.length },
  ];
  if (plan.confirmedAt !== null) {
    events.push({ at: at(plan.confirmedAt), type: 'confirmed', role: plan.confirmedRole });
  }
  // `steps` arrive by ordinal, which is the order they run in.
  for (const s of steps) {
    if (s.startedAt !== null) {
      events.push({ at: at(s.startedAt), type: 'step_started', ordinal: s.ordinal, tool: s.tool });
    }
    if (s.finishedAt !== null && s.status !== 'PENDING' && s.status !== 'RUNNING') {
      events.push({
        at: at(s.finishedAt),
        type: 'step_finished',
        ordinal: s.ordinal,
        tool: s.tool,
        status: s.status,
        error: s.error,
      });
    }
  }
  if (plan.finishedAt !== null) {
    events.push({
      at: at(plan.finishedAt),
      type: 'ended',
      status: plan.status,
      confirmation: plan.confirmationStatus,
      reason: plan.reason,
    });
  }
  return {
    planId: plan.id,
    sessionId: plan.sessionId,
    status: plan.status,
    outcome,
    correlationId,
    unknown:
      plan.finishedAt === null
        ? []
        : steps.filter((s) => s.status === 'RUNNING').map((s) => s.ordinal),
    events,
    audit: [...audits]
      .sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime())
      .map((a) => ({
        at: at(a.occurredAt),
        action: a.action,
        outcome: codeOf(a),
        correlationId: a.correlationId,
      })),
  };
}
