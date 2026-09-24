import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { currentContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { RateLimitService } from '../../auth/rate-limit.service';
import { ASSISTANT_TOOLS, assertRegistrable, type AssistantTool } from './assistant-tool';

/**
 * The only way a tool runs (`ai-tool-registry`, T-018).
 *
 * ```
 * registered? → active → workspace → role → rate limit → input → execute → output → audit
 * ```
 *
 * Every step runs on every call. The assistant having decided to call a tool proves nothing, so
 * the caller is re-authorized here, and again by the service the tool calls.
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

  async invoke<I, O>(
    actor: Actor,
    tool: AssistantTool<I, O>,
    args: unknown,
    req: RequestContext,
  ): Promise<O> {
    // By identity, not only by name: a tool built somewhere else under a registered name is not
    // the tool that was checked.
    if (this.registered.get(tool.name) !== (tool as AssistantTool)) {
      throw new Error(`assistant tool ${JSON.stringify(tool.name)} is not registered`);
    }
    const c: AuthzContext = {
      action: tool.auditEvent,
      resourceType: 'assistant_tool',
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
    await this.authz.requireActive(actor, c);
    await this.authz.requireWorkspace(actor, currentContext() !== undefined, c);
    await this.requireAnyRole(actor, tool, c);
    await this.limits.consumeWithin(`aiTool:${tool.name}`, actor.userId, {
      max: tool.rateLimit.perMinute,
      windowSeconds: 60,
    });

    const parsed = tool.input.safeParse(args);
    if (!parsed.success) {
      await this.record(actor, tool, 'rejected: invalid arguments', req);
      throw AppError.validation(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'arguments',
          code: 'INVALID',
          messageKey: 'error.validation.assistant_tool.invalid',
        })),
      );
    }

    const result = tool.output.parse(await tool.execute(actor, parsed.data, req));
    await this.record(actor, tool, `ok: ${tool.auditArguments(parsed.data)}`, req);
    return result;
  }

  /**
   * One of the tool's roles, as the actor holds it now. Refused through `requireRole` so the
   * refusal is audited like every other: with no role in common, the first role required is one
   * the actor either does not hold or has not got active.
   */
  private async requireAnyRole(actor: Actor, tool: AssistantTool, c: AuthzContext): Promise<void> {
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
    tool: AssistantTool,
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
