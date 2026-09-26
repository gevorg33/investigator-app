import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db, type Tx } from '../../../database/database.module';
import { tenantMemberships, users } from '../../../database/schema';
import { EmployeeRoles, permissionsOf, type CatalogRole } from './employee-roles';
import type { UpdateEmployeeDto } from './employees.dto';

type MembershipStatus = (typeof tenantMemberships.$inferSelect)['status'];

/** A member as their colleagues with `employees.read` see them. Identity is the user's, read live. */
export interface EmployeeView {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  status: Exclude<MembershipStatus, 'REMOVED'>;
  /** The catalog's keys, for display; nothing is decided from them. */
  roles: string[];
  jobTitle: string | null;
  department: string | null;
  locale: string | null;
  timezone: string | null;
  joinedAt: Date;
  /** Whether this is the reader. */
  you: boolean;
}

/** The workspace the request acts in — from the context, never from code (tenancy.md §6). */
const THIS_WORKSPACE = sql`app_current_tenant()`;

/** The database's last-owner invariant (migration 0011), said as what it means to the reader. */
const LAST_OWNER = 'tenant_has_active_owner';

/**
 * An agency's members (T-085, tenancy.md §2): who they are, their details, their roles, and
 * suspending, reactivating and removing them.
 *
 * Membership is read on every request, never carried in a token, so each change here lands on the
 * member's **next** request: a suspended or removed member is refused, and a changed role grants or
 * withdraws on the next call, with nothing to invalidate.
 *
 * Two rules sit beside the permission each action needs:
 * - **Nothing upward** (`requireHoldsAll`): no one may act on a member who holds a permission they
 *   do not, nor grant a role that does.
 * - **An agency always has an owner**: the database refuses, at commit, any change that leaves it
 *   none — removing, suspending or re-roling the last one — and that refusal is said here.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly roles: EmployeeRoles,
  ) {}

  async list(actor: Actor, req: RequestContext): Promise<EmployeeView[]> {
    await this.require(actor, 'employees.read', this.ctx('employees.list', req));
    const rows = await this.db
      .select(columns)
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, THIS_WORKSPACE),
          ne(tenantMemberships.status, 'REMOVED'),
        ),
      )
      .orderBy(asc(tenantMemberships.status), asc(users.email));
    const held = await this.roles.ofMemberships(rows.map((r) => r.membershipId));
    return rows.map((r) => view(r, held.get(r.membershipId)!, actor));
  }

  /** The member's own details here. Absent is left alone; null clears. */
  async update(
    actor: Actor,
    membershipId: string,
    changes: UpdateEmployeeDto,
    req: RequestContext,
  ): Promise<EmployeeView> {
    const c = this.ctx('employees.update', req, membershipId);
    await this.require(actor, 'employees.update', c);
    const fields = (['jobTitle', 'department', 'locale', 'timezone'] as const).filter(
      (f) => changes[f] !== undefined,
    );
    return this.db.transaction(async (tx) => {
      const { row, held } = await this.target(actor, membershipId, c, tx);
      await this.authz.requireHoldsAll(actor, permissionsOf(held), c);
      // Text as stored: trimmed, and blank is no text.
      const text = (v: string | null) => (v === null || v.trim() === '' ? null : v.trim());
      if (fields.length > 0) {
        await tx
          .update(tenantMemberships)
          .set({
            ...(changes.jobTitle !== undefined && { jobTitle: text(changes.jobTitle) }),
            ...(changes.department !== undefined && { department: text(changes.department) }),
            ...(changes.locale !== undefined && { locale: changes.locale }),
            ...(changes.timezone !== undefined && { timezone: changes.timezone }),
            updatedAt: new Date(),
          })
          .where(eq(tenantMemberships.id, row.membershipId));
        await this.record(actor, req, 'employees.updated', membershipId, fields.join(','), tx);
      }
      return this.one(actor, membershipId, tx);
    });
  }

  /** The whole set of roles the member holds from now on. */
  async setRoles(
    actor: Actor,
    membershipId: string,
    keys: readonly string[],
    req: RequestContext,
  ): Promise<EmployeeView> {
    const c = this.ctx('employees.set_roles', req, membershipId);
    await this.require(actor, 'employees.update', c);
    return this.translateLastOwner(() =>
      this.db.transaction(async (tx) => {
        const { held } = await this.target(actor, membershipId, c, tx);
        const wanted = await this.roles.byKeys(keys, tx);
        const unknown = [...new Set(keys)].filter((k) => !wanted.some((r) => r.key === k));
        if (unknown.length > 0) {
          throw AppError.validation([
            {
              field: 'roles',
              code: 'UNKNOWN',
              messageKey: 'error.validation.employees.role_unknown',
            },
          ]);
        }
        // Neither who they are now, nor what they would become, may be more than the actor.
        await this.authz.requireHoldsAll(actor, permissionsOf(held), c);
        await this.authz.requireHoldsAll(actor, permissionsOf(wanted), c);
        await this.roles.replace(
          membershipId,
          wanted.map((r) => r.id),
          tx,
        );
        await this.record(
          actor,
          req,
          'employees.roles_changed',
          membershipId,
          wanted.map((r) => r.key).join(','),
          tx,
        );
        return this.one(actor, membershipId, tx);
      }),
    );
  }

  /** Refused on their next request; roles and details kept, for reactivating. */
  async suspend(actor: Actor, membershipId: string, req: RequestContext): Promise<EmployeeView> {
    return this.move(actor, membershipId, 'SUSPENDED', req);
  }

  async reactivate(actor: Actor, membershipId: string, req: RequestContext): Promise<EmployeeView> {
    return this.move(actor, membershipId, 'ACTIVE', req);
  }

  /**
   * Out of the agency: refused on their next request, and their roles taken. The row stays, so the
   * audit trail and who did what keep their subject; a new invitation brings the same row back.
   */
  async remove(actor: Actor, membershipId: string, req: RequestContext): Promise<void> {
    const c = this.ctx('employees.remove', req, membershipId);
    await this.require(actor, 'employees.remove', c);
    await this.translateLastOwner(() =>
      this.db.transaction(async (tx) => {
        const { row, held } = await this.target(actor, membershipId, c, tx);
        await this.authz.requireHoldsAll(actor, permissionsOf(held), c);
        await tx
          .update(tenantMemberships)
          .set({ status: 'REMOVED', updatedAt: new Date() })
          .where(eq(tenantMemberships.id, row.membershipId));
        await this.roles.clear(membershipId, tx);
        await this.record(actor, req, 'employees.removed', membershipId, undefined, tx);
      }),
    );
  }

  private async move(
    actor: Actor,
    membershipId: string,
    to: 'ACTIVE' | 'SUSPENDED',
    req: RequestContext,
  ): Promise<EmployeeView> {
    const action = to === 'SUSPENDED' ? 'employees.suspend' : 'employees.reactivate';
    const c = this.ctx(action, req, membershipId);
    await this.require(actor, 'employees.suspend', c);
    return this.translateLastOwner(() =>
      this.db.transaction(async (tx) => {
        const { row, held } = await this.target(actor, membershipId, c, tx);
        await this.authz.requireHoldsAll(actor, permissionsOf(held), c);
        // Suspending yourself would lock you out with no way back; someone else must do it.
        if (to === 'SUSPENDED' && row.userId === actor.userId) {
          throw AppError.conflictOn(
            'membership',
            'SELF',
            'error.validation.employees.not_yourself',
          );
        }
        await this.authz.stateAllows(
          actor,
          row.status === (to === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'),
          c,
        );
        await tx
          .update(tenantMemberships)
          .set({ status: to, updatedAt: new Date() })
          .where(eq(tenantMemberships.id, row.membershipId));
        await this.record(
          actor,
          req,
          to === 'SUSPENDED' ? 'employees.suspended' : 'employees.reactivated',
          membershipId,
          undefined,
          tx,
        );
        return this.one(actor, membershipId, tx);
      }),
    );
  }

  /** A member of this workspace who has not left, locked for the change, with what they hold. */
  private async target(
    actor: Actor,
    membershipId: string,
    c: AuthzContext,
    tx: Tx,
  ): Promise<{ row: Row; held: CatalogRole[] }> {
    const [found] = await tx
      .select(columns)
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, THIS_WORKSPACE),
          ne(tenantMemberships.status, 'REMOVED'),
        ),
      )
      .for('update', { of: tenantMemberships });
    const row = await this.authz.visible(actor, found, c);
    const held = (await this.roles.ofMemberships([membershipId], tx)).get(membershipId)!;
    return { row, held };
  }

  private async one(actor: Actor, membershipId: string, tx: Tx): Promise<EmployeeView> {
    const [row] = await tx
      .select(columns)
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(eq(tenantMemberships.id, membershipId));
    const held = (await this.roles.ofMemberships([membershipId], tx)).get(membershipId)!;
    return view(row!, held, actor);
  }

  /**
   * The database checks the last-owner rule at commit, whoever writes (migration 0011). Its refusal
   * becomes the reader's: an agency must keep an owner.
   */
  private async translateLastOwner<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const pg = (e as { cause?: unknown }).cause ?? e;
      const { code, constraint_name } = pg as { code?: string; constraint_name?: string };
      if (code === '23514' && constraint_name === LAST_OWNER) {
        throw AppError.conflictOn(
          'membership',
          'LAST_OWNER',
          'error.validation.employees.last_owner',
        );
      }
      throw e;
    }
  }

  private async require(
    actor: Actor,
    permission: 'employees.read' | 'employees.update' | 'employees.suspend' | 'employees.remove',
    c: AuthzContext,
  ): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireAgencyWorkspace(actor, c);
    await this.authz.requirePermission(actor, permission, c);
  }

  private async record(
    actor: Actor,
    req: RequestContext,
    action: string,
    membershipId: string,
    reason: string | undefined,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: actor.userId,
        action,
        resourceType: 'tenant_membership',
        resourceId: membershipId,
        reason,
      },
      tx,
    );
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'tenant_membership',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

const columns = {
  membershipId: tenantMemberships.id,
  userId: tenantMemberships.userId,
  status: tenantMemberships.status,
  jobTitle: tenantMemberships.jobTitle,
  department: tenantMemberships.department,
  locale: tenantMemberships.locale,
  timezone: tenantMemberships.timezone,
  joinedAt: tenantMemberships.createdAt,
  email: users.email,
  displayName: users.displayName,
};

type Row = {
  membershipId: string;
  userId: string;
  status: MembershipStatus;
  jobTitle: string | null;
  department: string | null;
  locale: string | null;
  timezone: string | null;
  joinedAt: Date;
  email: string;
  displayName: string | null;
};

function view(row: Row, held: readonly CatalogRole[], actor: Actor): EmployeeView {
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    status: row.status as EmployeeView['status'],
    roles: held.map((r) => r.key),
    jobTitle: row.jobTitle,
    department: row.department,
    locale: row.locale,
    timezone: row.timezone,
    joinedAt: row.joinedAt,
    you: row.userId === actor.userId,
  };
}
