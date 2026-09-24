import { z } from 'zod';
import type { Actor, Role } from '../../../common/authz/contract';
import type { RequestContext } from '../../../common/http/request-context';

/** DI token for the registered tools: an interface does not exist at runtime. */
export const ASSISTANT_TOOLS = Symbol('ASSISTANT_TOOLS');

export type ResourceScope = 'own' | 'assignment_participant' | 'staff_scoped' | 'public_projection';

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
  execute(actor: Actor, input: I, req: RequestContext): Promise<O>;
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
 * Write tools do not register at all yet. A write needs a confirmation the user gives and the
 * model never sees, bound to the exact arguments and used once (`ai-tool-registry`), and that
 * flow is T-048's. Until it exists, the only safe write tool is none.
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
  if (tool.operation === 'write') {
    refuse('write tools need the confirmation flow, which does not exist yet (T-048)');
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
