import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { currentContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { RateLimitService } from '../../auth/rate-limit.service';
import {
  ASSISTANT_TOOLS,
  assertRegistrable,
  type AssistantTool,
  type ToolEffect,
} from './assistant-tool';

/** What the checks read of a tool, whatever its input and output. */
type Declared = Pick<
  AssistantTool,
  'name' | 'operation' | 'auditEvent' | 'requiredRoles' | 'rateLimit'
>;

/**
 * The only way a tool runs (`ai-tool-registry`, T-018, T-048).
 *
 * ```
 * read    invoke:        registered? → active → workspace → role → rate limit → input → execute → output → audit
 * write   prepare:       registered? → active → workspace → role → rate limit → input → observe → audit (proposed)
 *         runConfirmed:  registered? → active → workspace → role → input → execute(effect) → output → audit
 * ```
 *
 * Every step runs on every call. The assistant having decided to call a tool proves nothing, so
 * the caller is re-authorized here, and again by the service the tool calls. A write never runs on
 * the model's call: it is prepared into a plan, the person confirms the plan, and the plan runs it.
 */
@Injectable()
export class ToolRunner {
  private readonly registered = new Map<string, AssistantTool>();

  constructor(
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    @Inject(ASSISTANT_TOOLS) tools: readonly AssistantTool[],
  ) {
    for (const tool of tools) {
      assertRegistrable(tool);
      if (this.registered.has(tool.name)) {
        throw new Error(`assistant tool ${JSON.stringify(tool.name)} is registered twice`);
      }
      this.registered.set(tool.name, tool);
    }
  }

  /** Every registered tool, for the static checks that hold across all of them. */
  tools(): AssistantTool[] {
    return [...this.registered.values()];
  }

  /** The registered tool of that name — how a stored plan step finds what it runs. */
  find(name: string): AssistantTool | undefined {
    return this.registered.get(name);
  }

  /** A read, on the model's call. A write is refused here: it runs only through a confirmed plan. */
  async invoke<I, O>(
    actor: Actor,
    tool: AssistantTool<I, O>,
    args: unknown,
    req: RequestContext,
  ): Promise<O> {
    this.expect(tool, 'read');
    await this.admit(actor, tool, req);
    await this.consume(actor, tool);
    const input = await this.parse(actor, tool, args, req);
    const result = tool.output.parse(await tool.execute(actor, input, req));
    await this.record(actor, tool, `ok: ${tool.auditArguments(input)}`, req);
    return result;
  }

  /**
   * A write the model proposes, checked as it would be to run — and not run. What comes back is a
   * plan step: the arguments as parsed, which is what the person will confirm, and what the tool
   * observes it would act on, which the plan keeps a digest of and reads again before it runs
   * (T-048). The proposal is audited; the rate limit is spent here, where the model is the caller.
   */
  async prepare<I, O>(
    actor: Actor,
    tool: AssistantTool<I, O>,
    args: unknown,
    req: RequestContext,
  ): Promise<{ arguments: I; observed: unknown }> {
    this.expect(tool, 'write');
    await this.admit(actor, tool, req);
    await this.consume(actor, tool);
    const input = await this.parse(actor, tool, args, req);
    const observed = await tool.observe!(actor, input, req);
    await this.record(actor, tool, `proposed: ${tool.auditArguments(input)}`, req);
    return { arguments: input, observed };
  }

  /** What a stored step acts on, read again now, as the caller — the re-check before running. */
  async observe<I, O>(
    actor: Actor,
    tool: AssistantTool<I, O>,
    args: unknown,
    req: RequestContext,
  ): Promise<unknown> {
    this.expect(tool, 'write');
    await this.admit(actor, tool, req);
    return tool.observe!(actor, await this.parse(actor, tool, args, req), req);
  }

  /**
   * One step of a plan its person confirmed. Every check again — the account, the workspace, the
   * role as held now, the arguments parsed strictly — except the rate limit, because the person
   * decided this, not the model. `effect` carries the step's idempotency key.
   */
  async runConfirmed<I, O>(
    actor: Actor,
    tool: AssistantTool<I, O>,
    args: unknown,
    req: RequestContext,
    effect: ToolEffect,
  ): Promise<O> {
    this.expect(tool, 'write');
    await this.admit(actor, tool, req);
    const input = await this.parse(actor, tool, args, req);
    const result = tool.output.parse(await tool.execute(actor, input, req, effect));
    await this.record(actor, tool, `ok: confirmed: ${tool.auditArguments(input)}`, req);
    return result;
  }

  /**
   * Registered — by identity, not only by name: a tool built somewhere else under a registered name
   * is not the tool that was checked — and of the operation this path is for.
   */
  private expect(tool: Declared, operation: 'read' | 'write'): void {
    if ((this.registered.get(tool.name) as Declared | undefined) !== tool) {
      throw new Error(`assistant tool ${JSON.stringify(tool.name)} is not registered`);
    }
    if (tool.operation !== operation) {
      throw new Error(
        operation === 'read'
          ? `assistant tool ${JSON.stringify(tool.name)} is a write: it runs only through a confirmed plan (T-048)`
          : `assistant tool ${JSON.stringify(tool.name)} is a read: it is run, not proposed`,
      );
    }
  }

  /** The caller as they are now: a live account, in a workspace, holding one of the tool's roles. */
  private async admit(actor: Actor, tool: Declared, req: RequestContext): Promise<void> {
    const c: AuthzContext = {
      action: tool.auditEvent,
      resourceType: 'assistant_tool',
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
    await this.authz.requireActive(actor, c);
    await this.authz.requireWorkspace(actor, currentContext() !== undefined, c);
    await this.requireAnyRole(actor, tool, c);
  }

  private async consume(actor: Actor, tool: Declared): Promise<void> {
    await this.limits.consumeWithin(`aiTool:${tool.name}`, actor.userId, {
      max: tool.rateLimit.perMinute,
      windowSeconds: 60,
    });
  }

  /** The arguments, strictly: one the tool does not name is refused, and the refusal audited. */
  private async parse<I>(
    actor: Actor,
    tool: AssistantTool<I, unknown>,
    args: unknown,
    req: RequestContext,
  ): Promise<I> {
    const parsed = tool.input.safeParse(args);
    if (parsed.success) return parsed.data;
    await this.record(actor, tool, 'rejected: invalid arguments', req);
    throw AppError.validation(
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'arguments',
        code: 'INVALID',
        messageKey: 'error.validation.assistant_tool.invalid',
      })),
    );
  }

  /**
   * One of the tool's roles, as the actor holds it now. Refused through `requireRole` so the
   * refusal is audited like every other: with no role in common, the first role required is one
   * the actor either does not hold or has not got active.
   */
  private async requireAnyRole(actor: Actor, tool: Declared, c: AuthzContext): Promise<void> {
    const active = actor.roles.filter(
      (role) => actor.activeRole === undefined || actor.activeRole === role,
    );
    if (!tool.requiredRoles.some((role) => active.includes(role))) {
      await this.authz.requireRole(actor, tool.requiredRoles[0]!, c);
    }
  }

  /** Who called which tool, how it went, and the redacted shape of the arguments. */
  private async record(
    actor: Actor,
    tool: Pick<AssistantTool, 'auditEvent'>,
    outcome: string,
    req: RequestContext,
  ): Promise<void> {
    await this.audit.record({
      correlationId: req.correlationId,
      actorId: actor.userId,
      action: tool.auditEvent,
      resourceType: 'assistant_tool',
      reason: outcome,
      ipAddress: req.ip,
      userAgent: req.userAgent,
    });
  }
}
