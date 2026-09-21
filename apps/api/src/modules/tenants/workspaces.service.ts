import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { currentContext } from '../../common/context/execution-context';
import { WorkspaceResolver } from '../../common/context/workspace.resolver';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { membershipRoles, roles, tenantMemberships, tenants, userSessions } from '../../database/schema';

/** A workspace as its member sees it in the switcher. */
export interface WorkspaceView {
  id: string;
  kind: 'PERSONAL' | 'AGENCY';
  /** Null for a Personal workspace, which the UI shows as "Personal". */
  name: string | null;
  status: 'CREATING' | 'ACTIVE';
  /** The caller's roles here. Shown, never checked: authorization reads permissions (T-078). */
  roles: string[];
  /** The workspace this request is running in. */
  current: boolean;
}

/**
 * The workspace switcher's API (T-075, tenancy.md §6). Choosing a workspace for one request is the
 * `X-Workspace` header; activating one sets the session's default for requests that send none.
 */
@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly resolver: WorkspaceResolver,
  ) {}

  /** Every workspace the caller can work in right now: Personal first, then agencies by name. */
  async list(actor: Actor, req: RequestContext): Promise<WorkspaceView[]> {
    await this.authz.requireActive(actor, this.ctx('workspace.list', req));
    const rows = await this.db
      .select({
        id: tenants.id,
        kind: tenants.kind,
        name: tenants.name,
        status: tenants.status,
        roles: sql<string[]>`coalesce(array_agg(${roles.key} ORDER BY ${roles.key})
                               FILTER (WHERE ${roles.key} IS NOT NULL), '{}')`,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .leftJoin(membershipRoles, eq(membershipRoles.membershipId, tenantMemberships.id))
      .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(
        and(
          eq(tenantMemberships.userId, actor.userId),
          eq(tenantMemberships.status, 'ACTIVE'),
          inArray(tenants.status, ['ACTIVE', 'CREATING']),
        ),
      )
      .groupBy(tenants.id)
      .orderBy(sql`${tenants.kind} = 'AGENCY'`, asc(tenants.name));

    const current = currentContext()?.tenantId;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      status: r.status as WorkspaceView['status'],
      roles: r.roles,
      current: r.id === current,
    }));
  }

  /**
   * Makes the requested workspace the session's default. The same test as the resolver's — an ACTIVE
   * membership in a usable workspace — so a workspace that could not be used cannot be defaulted.
   */
  async activate(actor: Actor, requested: string, req: RequestContext): Promise<{ id: string }> {
    const c = this.ctx('workspace.activate', req, requested);
    await this.authz.requireActive(actor, c);
    const found = await this.resolver.usable(actor, requested);
    await this.authz.requireWorkspace(actor, found !== undefined, c);

    await this.db
      .update(userSessions)
      .set({ defaultTenantId: requested })
      .where(eq(userSessions.id, actor.sessionId));
    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: actor.userId,
      action: 'workspace.activated',
      resourceType: 'tenant',
      resourceId: requested,
    });
    return { id: requested };
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'tenant',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}
