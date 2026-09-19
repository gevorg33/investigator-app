import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../../database/database.module';
import {
  membershipRoles,
  rolePermissions,
  tenantMemberships,
  tenants,
  userSessions,
} from '../../database/schema';
import { AuthzService, type AuthzContext } from '../authz/authz.service';
import type { Actor } from '../authz/contract';
import type { ExecutionContext } from './execution-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A workspace can be worked in while it is being set up or running — not once stopped. */
const USABLE_STATUSES = ['ACTIVE', 'CREATING'] as const;

/**
 * Check 0: which workspace this request acts in (T-075, docs/architecture/tenancy.md §6).
 *
 * - `X-Workspace` names it. It is **intersected** with the caller's memberships, read now: it can
 *   only choose among workspaces the caller already belongs to, never grant one. Naming a
 *   workspace the caller is not an ACTIVE member of — or one that is suspended, archived or
 *   deleted — is refused with 403 and audited.
 * - With no header, the session's default is used while it is still usable. When it is not —
 *   the member was removed, the workspace suspended — the request falls back to the caller's
 *   Personal workspace, which is always theirs, and the default follows it (owner decision,
 *   2026-09-19). The web app always sends the header, so a tab never writes into a workspace it
 *   is not showing.
 *
 * Memberships and permissions are read on every request, never carried in a token: a removed
 * member is refused on their very next request.
 */
@Injectable()
export class WorkspaceResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
  ) {}

  async resolve(
    actor: Actor,
    requested: string | undefined,
    audit: Pick<AuthzContext, 'correlationId' | 'ipAddress'> = {},
  ): Promise<ExecutionContext> {
    if (requested !== undefined && requested !== '') {
      const found = UUID.test(requested) ? await this.usable(actor.userId, requested) : undefined;
      await this.authz.requireWorkspace(actor, found !== undefined, {
        action: 'workspace.use',
        resourceType: 'tenant',
        resourceId: UUID.test(requested) ? requested : undefined,
        ...audit,
      });
      return found!;
    }

    const [session] = await this.db
      .select({ defaultTenantId: userSessions.defaultTenantId })
      .from(userSessions)
      .where(eq(userSessions.id, actor.sessionId));
    const preferred = session?.defaultTenantId ?? null;
    if (preferred !== null) {
      const found = await this.usable(actor.userId, preferred);
      if (found !== undefined) return found;
    }

    const personal = await this.personal(actor.userId);
    await this.db
      .update(userSessions)
      .set({ defaultTenantId: personal.tenantId })
      .where(eq(userSessions.id, actor.sessionId));
    return personal;
  }

  /**
   * The context for a requested workspace, if the caller may work in it right now; otherwise
   * undefined. `requested` is a candidate to check against memberships, never one to act in.
   */
  async usable(userId: string, requested: string): Promise<ExecutionContext | undefined> {
    const [row] = await this.db
      .select({
        tenantId: tenants.id,
        tenantKind: tenants.kind,
        membershipId: tenantMemberships.id,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.tenantId, requested),
          eq(tenantMemberships.status, 'ACTIVE'),
          inArray(tenants.status, [...USABLE_STATUSES]),
        ),
      );
    if (row === undefined) return undefined;
    return { ...row, userId, permissions: await this.permissionsOf(row.membershipId) };
  }

  /**
   * The caller's Personal workspace. The trigger that made the user made it (T-074), so it
   * exists; it is ACTIVE for as long as the account is. A request never runs without a workspace.
   */
  private async personal(userId: string): Promise<ExecutionContext> {
    const [row] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.personalOwnerId, userId));
    const found = await this.usable(userId, row!.id);
    return found!;
  }

  private async permissionsOf(membershipId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ key: rolePermissions.permissionKey })
      .from(membershipRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, membershipId));
    return rows.map((r) => r.key).sort();
  }
}
