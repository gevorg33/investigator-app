import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Actor, StaffScope } from '../authz/contract';
import { AppError } from '../errors/app-error';
import type { RequestContext } from '../http/request-context';
import {
  enterPlatformAccess,
  type AdHocPurpose,
  type PlatformAccess,
  type RoutePurpose,
  type SystemPurpose,
} from './platform-access';

export { currentPlatformAccess } from './platform-access';
export type { PlatformAccess, PlatformScope } from './platform-access';

/**
 * Crossing workspaces on purpose (T-077, T-079; docs/architecture/tenancy.md §8).
 *
 * Row-level security confines every query to the caller's workspace. Two kinds of work are not
 * confined to one: platform staff reviewing what investigators submitted, and system operations
 * with no user at all — an assignment created when a payment is authorized. Both run here and
 * nowhere else: this is the only code that can turn on `app.platform_access`, which the policies
 * honour, and `tenant-plumbing.spec.ts` holds that, listing every caller.
 *
 * Entering is not authorizing. The caller has already made its checks — and audited a refusal —
 * through `AuthzService`; entry re-checks the staff role and the scope, so a missed check fails
 * closed rather than widening what the database shows.
 *
 * **Every entry is audited before the work runs**, so a crossing that then fails is still
 * recorded. That row is deliberately separate from whatever the action writes afterwards:
 * crossing a workspace boundary is its own fact, and the correlation id ties the two together.
 */
/**
 * What is being asked for. The two shapes are the point: a route purpose takes no reason, and an
 * ad-hoc one does not compile without it. A new ad-hoc purpose cannot be added without one.
 */
export type PlatformAccessRequest =
  | { readonly scope: StaffScope; readonly purpose: RoutePurpose; readonly reason?: never }
  | { readonly scope: StaffScope; readonly purpose: AdHocPurpose; readonly reason: string };

/**
 * Long enough to be a sentence about this case rather than a word that fits the box. Short
 * reasons are how a reason field becomes a formality.
 */
const MIN_REASON_LENGTH = 12;

@Injectable()
export class PlatformContext {
  constructor(private readonly audit: AuditService) {}

  /**
   * Runs `fn` with access across workspaces, for a staff member acting as staff and holding the
   * scope. Someone who is also a customer does not carry it into their customer role.
   */
  async asStaff<T>(
    actor: Actor,
    access: PlatformAccessRequest,
    req: RequestContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const actingAsStaff = actor.activeRole === undefined || actor.activeRole === 'STAFF';
    if (
      !actingAsStaff ||
      !actor.roles.includes('STAFF') ||
      !actor.staffScopes.includes(access.scope)
    ) {
      throw AppError.forbidden();
    }

    const reason = access.reason ?? null;
    if (reason !== null && reason.trim().length < MIN_REASON_LENGTH) {
      throw AppError.validation([
        { field: 'reason', code: 'TOO_SHORT', messageKey: 'error.validation.platform.reason' },
      ]);
    }

    return this.enter(
      { scope: access.scope, purpose: access.purpose, reason, actorId: actor.userId },
      req,
      fn,
    );
  }

  /**
   * Runs `fn` as the system: no user, no workspace. Only for operations no person can trigger,
   * which `tenant-plumbing.spec.ts` lists by caller.
   */
  async asSystem<T>(purpose: SystemPurpose, req: RequestContext, fn: () => Promise<T>): Promise<T> {
    return this.enter({ scope: 'SYSTEM', purpose, reason: null, actorId: null }, req, fn);
  }

  /**
   * The audit row goes in first, through its own statement — outside any transaction `fn` may
   * open and roll back. A crossing that happened is recorded whether or not the work survived.
   */
  private async enter<T>(
    access: PlatformAccess,
    req: RequestContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: access.actorId ?? undefined,
      actorRole: access.actorId === null ? 'SYSTEM' : 'STAFF',
      staffScope: access.scope,
      action: 'platform.access',
      resourceType: 'workspace',
      // The purpose identifies the access; the reason, where one was required, says why this one.
      resourceId: access.purpose,
      reason: access.reason ?? undefined,
    });
    return enterPlatformAccess(access, fn);
  }
}
