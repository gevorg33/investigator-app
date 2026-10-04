import { z } from 'zod';
import type { Actor, Role } from '../../../common/authz/contract';
import type { RequestContext } from '../../../common/http/request-context';

/** DI token for the registered tools: an interface does not exist at runtime. */
export const ASSISTANT_TOOLS = Symbol('ASSISTANT_TOOLS');

export type ResourceScope = 'own' | 'assignment_participant' | 'staff_scoped' | 'public_projection';

/**
 * What a confirmed plan hands a write tool when it runs one of its steps (T-048). The key is the
 * step's own — `ai-plan:<plan>:<ordinal>` — and the tool is idempotent on it (ADR-0012): a worker
 * that dies between the tool's effect and the step's record is replaced by one that runs the step
 * again with the same key, and the second run must not do the thing twice.
 */
export interface ToolEffect {
  readonly idempotencyKey: string;
}

/**
 * Something the assistant may call (`ai-tool-registry`, T-018).
 *
 * The nine declared fields are the contract; `auditArguments` and `execute` are how it is kept.
 * A tool runs as the caller, inside the caller's workspace, through the same application service
 * the HTTP API uses — never a second implementation, and never with an actor, user, tenant or
 * workspace id among its inputs: those come from the session, and a model-supplied one is an
 * impersonation vector.
 */
export interface AssistantTool<I = unknown, O = unknown> {
  /** camelCase: `searchInvestigators`. */
  readonly name: string;
  readonly description: string;
  /** Any one of these, as the actor holds it now (an active role narrows it). */
  readonly requiredRoles: readonly Role[];
  readonly resourceScope: ResourceScope;
  readonly operation: 'read' | 'write';
  readonly confirmation: 'none' | 'required';
  /** A strict object: an argument the tool does not name is refused, not ignored. */
  readonly input: z.ZodType<I>;
  /** What leaves the tool. Anything the schema does not name is stripped on the way out. */
  readonly output: z.ZodType<O>;
  /** `ai.tool.<snake_case>`. */
  readonly auditEvent: string;
  readonly rateLimit: { perMinute: number };
  /** What of the arguments the audit row may hold: which filters, how many — never free text or coordinates. */
  auditArguments(input: I): string;
  /**
   * A write tool's view of what it would act on, read now as the caller — the status and version of
   * the mission, the quote, the message thread. The plan keeps a digest of it when proposed and reads
   * it again before running (T-048): a confirmation is for the state the person saw, and anything
   * material that changed since voids it. Required of every write tool, absent from reads.
   */
  observe?(actor: Actor, input: I, req: RequestContext): Promise<unknown>;
  /** `effect` is given to a write tool, by a confirmed plan, and never to a read. */
  execute(actor: Actor, input: I, req: RequestContext, effect?: ToolEffect): Promise<O>;
}

const SCOPES: readonly ResourceScope[] = [
  'own',
  'assignment_participant',
  'staff_scoped',
  'public_projection',
];

/**
 * An input naming who is acting, or where. Matched on the argument's name, so `userId`,
 * `tenant_id`, `workspace`, `membershipId` and `actor` are all refused at registration.
 */
const IDENTITY_ARGUMENT = /^(actor|user|tenant|workspace|membership)/i;

/**
 * Refuses a declaration that is missing a field or breaks a rule, naming what is wrong. Run for
 * every tool when the registry is built, so a bad tool stops the application starting rather
 * than reaching a user.
 *
 * A write tool registers only as `confirmation: 'required'` — lowering that is approval-gated
 * (AGENTS.md) — and with `observe`, the state a confirmation is checked against. It never runs on
 * the model's say-so: `ToolRunner.invoke` refuses it, and only a plan the person confirmed runs it
 * (T-048, `docs/architecture/ai-plans.md`).
 */
export function assertRegistrable(tool: AssistantTool): void {
  const refuse = (why: string): never => {
    throw new Error(`assistant tool ${JSON.stringify(tool.name)} cannot register: ${why}`);
  };
  if (typeof tool.name !== 'string' || !/^[a-z][A-Za-z]+$/.test(tool.name)) {
    refuse('name must be camelCase');
  }
  if (typeof tool.description !== 'string' || tool.description.trim() === '') {
    refuse('description is required');
  }
  if (!Array.isArray(tool.requiredRoles) || tool.requiredRoles.length === 0) {
    refuse('requiredRoles is required');
  }
  if (!SCOPES.includes(tool.resourceScope)) refuse('resourceScope is required');
  if (tool.operation !== 'read' && tool.operation !== 'write') refuse('operation is required');
  if (tool.confirmation !== 'none' && tool.confirmation !== 'required') {
    refuse('confirmation is required');
  }
  if (tool.operation === 'write' && tool.confirmation !== 'required') {
    refuse('a write tool requires confirmation');
  }
  if (tool.operation === 'write' && typeof tool.observe !== 'function') {
    refuse('a write tool observes the state it acts on');
  }
  if (
    !(tool.input instanceof z.ZodObject) ||
    tool.input._zod.def.catchall?._zod.def.type !== 'never'
  ) {
    refuse('input must be a strict object schema');
  }
  const named = Object.keys((tool.input as z.ZodObject).shape).filter((k) =>
    IDENTITY_ARGUMENT.test(k),
  );
  if (named.length > 0) refuse(`input names who is acting (${named.join(', ')})`);
  if (!(tool.output instanceof z.ZodType)) refuse('output schema is required');
  if (typeof tool.auditEvent !== 'string' || !/^ai\.tool\.[a-z_]+$/.test(tool.auditEvent)) {
    refuse('auditEvent must be ai.tool.<snake_case>');
  }
  if (!Number.isInteger(tool.rateLimit?.perMinute) || tool.rateLimit.perMinute < 1) {
    refuse('rateLimit.perMinute must be a positive integer');
  }
}
