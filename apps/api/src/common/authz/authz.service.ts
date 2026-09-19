import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { AuditService } from '../audit/audit.service';
import type { Actor, Role, StaffScope } from './contract';

/**
 * Why a denial happened. Recorded in the audit log; never sent to the caller, because the
 * distinction between "wrong role" and "not yours" is exactly what an attacker is probing
 * for.
 */
export type DenialReason =
  | 'account_not_active'
  | 'role_not_held'
  | 'role_not_active'
  | 'staff_scope_not_held'
  | 'not_staff'
  | 'resource_not_visible'
  | 'state_forbids_action'
  | 'workspace_not_available';

export interface AuthzContext {
  /** What is being attempted, e.g. 'mission.publish'. Audited on denial. */
  action: string;
  resourceType: string;
  resourceId?: string | undefined;
  correlationId?: string | undefined;
  ipAddress?: string | undefined;
}

/**
 * The six-check authorization procedure (`.claude/skills/authorization/SKILL.md`).
 *
 * Checks 1 and 2 — identity and account status — are settled when the Actor is built, so
 * an Actor that exists is already authenticated and its status is known. This service
 * covers 2, 3 and 6, which are answerable from the Actor alone, and provides the
 * vocabulary for 4 and 5, which are not.
 *
 * Checks 4 and 5 cannot live here. Whether an actor is a participant in *this* assignment,
 * and whether its state permits the action, are questions only the owning module can
 * answer. What this service does is make them impossible to skip silently: `visible` and
 * `stateAllows` take the answer and turn it into the right error and the right audit row.
 *
 * It is deliberately not a guard. A guard runs on the HTTP path only, and a service is
 * also reachable from a job, an event handler, another module and an AI tool.
 */
@Injectable()
export class AuthzService {
  constructor(private readonly audit: AuditService) {}

  /** Check 2. Only an ACTIVE account may act; everything else is refused. */
  async requireActive(actor: Actor, ctx: AuthzContext): Promise<void> {
    if (actor.status !== 'ACTIVE') await this.deny(actor, ctx, 'account_not_active');
  }

  /**
   * Check 3 — may this actor perform this action in principle?
   *
   * Two conditions, not one. The role must be held, and if the actor has narrowed
   * themselves to a single active role, it must be that one. Narrowing can only ever
   * remove permissions: `activeRole` is intersected with `roles`, never added to it, so
   * a client asserting a role it does not hold gains nothing.
   */
  async requireRole(actor: Actor, role: Role, ctx: AuthzContext): Promise<void> {
    if (!actor.roles.includes(role)) await this.deny(actor, ctx, 'role_not_held');
    if (actor.activeRole !== undefined && actor.activeRole !== role) {
      await this.deny(actor, ctx, 'role_not_active');
    }
  }

  /**
   * Check 6 — staff scope, and never merely "is staff".
   *
   * The rule the skill states outright: a moderator is not a payments reviewer. Every
   * staff action names the one area it belongs to.
   */
  async requireStaffScope(actor: Actor, scope: StaffScope, ctx: AuthzContext): Promise<void> {
    if (!actor.roles.includes('STAFF')) await this.deny(actor, ctx, 'not_staff');
    if (!actor.staffScopes.includes(scope)) await this.deny(actor, ctx, 'staff_scope_not_held');
  }

  /**
   * Check 4 — the actor's relationship to the resource.
   *
   * Takes the result of an actor-scoped query. A miss means either the row does not exist
   * or it is not theirs, and the two are answered identically on purpose: a 403 here would
   * confirm the id is real and turn the endpoint into an enumeration oracle.
   */
  async visible<T>(actor: Actor, row: T | undefined | null, ctx: AuthzContext): Promise<T> {
    // `deny` returns Promise<never>, so returning it satisfies Promise<T> without a
    // second unreachable throw standing in for the type checker.
    if (row === undefined || row === null) return this.deny(actor, ctx, 'resource_not_visible');
    return row;
  }

  /**
   * Check 5 — does the resource's state permit this action?
   *
   * 403 rather than 404: the actor has already been shown to be a participant, so the
   * row's existence is not news to them. Refusing loudly is more useful than pretending
   * it is missing.
   */
  async stateAllows(actor: Actor, allowed: boolean, ctx: AuthzContext): Promise<void> {
    if (!allowed) await this.deny(actor, ctx, 'state_forbids_action');
  }

  /**
   * Check 0 — the workspace (ADR-0011). The actor must hold an ACTIVE membership in a workspace
   * that is neither suspended, archived nor deleted. 403, not 404: the caller named the
   * workspace, and "you may not use it" reveals nothing a membership list would not.
   */
  async requireWorkspace(actor: Actor, allowed: boolean, ctx: AuthzContext): Promise<void> {
    if (!allowed) await this.deny(actor, ctx, 'workspace_not_available');
  }

  /**
   * Every denial is audited before it is thrown.
   *
   * A refusal nobody records is a refusal nobody can investigate — a burst of them across
   * many ids is what enumeration looks like from the inside, and it is invisible without
   * these rows.
   */
  private async deny(actor: Actor, ctx: AuthzContext, reason: DenialReason): Promise<never> {
    await this.audit.record({
      actorId: actor.userId,
      action: `authz.denied.${ctx.action}`,
      resourceType: ctx.resourceType,
      resourceId: ctx.resourceId,
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      reason,
    });

    // The caller learns only "no". Which of the six checks failed stays in the audit log.
    throw reason === 'resource_not_visible' ? AppError.notFound() : AppError.forbidden();
  }
}
