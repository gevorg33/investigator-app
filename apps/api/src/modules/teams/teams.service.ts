import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { teamMembers, teams, tenantMemberships, users } from '../../database/schema';
import type { CreateTeamDto, UpdateTeamDto } from './teams.dto';

/** A member as a team lists them. Identity is the user's, read live. */
export interface TeamMemberView {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface TeamView {
  id: string;
  name: string;
  description: string | null;
  members: TeamMemberView[];
  createdAt: Date;
}

/** The workspace the request acts in — from the context, never from code (tenancy.md §6). */
const THIS_WORKSPACE = sql`app_current_tenant()`;

/** Text as stored: trimmed, and blank is no text. */
const clean = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * An agency's teams (T-086, tenancy.md §4): created, renamed, deleted, and who is in them. A member
 * may be in several; a removed member leaves every team (a trigger, migration 0029) and cannot be
 * put back in one; a suspended member stays, as they keep their roles.
 *
 * Teams grant nothing by themselves. They are what assignment staffing and `investigations.read`
 * (T-089) and notification routing (T-036) will read. Everyone in the agency reads them
 * (`teams.read`); OWNER, ADMIN and MANAGER change them (`teams.create|update|delete`).
 */
@Injectable()
export class TeamsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, req: RequestContext): Promise<TeamView[]> {
    await this.require(actor, 'teams.read', this.ctx('teams.list', req));
    const rows = await this.db
      .select()
      .from(teams)
      .where(eq(teams.tenantId, THIS_WORKSPACE))
      .orderBy(asc(sql`lower(${teams.name})`));
    return this.views(rows, this.db);
  }

  async read(actor: Actor, id: string, req: RequestContext): Promise<TeamView> {
    const c = this.ctx('teams.read', req, id);
    await this.require(actor, 'teams.read', c);
    return this.one(actor, id, c, this.db);
  }

  async create(actor: Actor, dto: CreateTeamDto, req: RequestContext): Promise<TeamView> {
    const c = this.ctx('teams.create', req);
    await this.require(actor, 'teams.create', c);
    const name = clean(dto.name);
    if (name === null) throw nameLength();
    return nameTaken(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(teams)
          .values({
            name,
            description: dto.description === undefined ? null : clean(dto.description),
          })
          .returning();
        await this.record(actor, req, 'teams.created', row!.id, undefined, tx);
        return (await this.views([row!], tx))[0]!;
      }),
    );
  }

  async update(
    actor: Actor,
    id: string,
    dto: UpdateTeamDto,
    req: RequestContext,
  ): Promise<TeamView> {
    const c = this.ctx('teams.update', req, id);
    await this.require(actor, 'teams.update', c);
    const name = dto.name === undefined ? undefined : clean(dto.name);
    if (name === null) throw nameLength();
    return nameTaken(() =>
      this.db.transaction(async (tx) => {
        await this.one(actor, id, c, tx);
        const changed = [
          ...(name !== undefined ? ['name'] : []),
          ...(dto.description !== undefined ? ['description'] : []),
        ];
        if (changed.length > 0) {
          await tx
            .update(teams)
            .set({
              ...(name !== undefined && { name }),
              ...(dto.description !== undefined && {
                description: dto.description === null ? null : clean(dto.description),
              }),
              updatedAt: new Date(),
            })
            .where(eq(teams.id, id));
          await this.record(actor, req, 'teams.updated', id, changed.join(','), tx);
        }
        return this.one(actor, id, c, tx);
      }),
    );
  }

  /** The team and who was in it; the members themselves stay in the agency. */
  async remove(actor: Actor, id: string, req: RequestContext): Promise<void> {
    const c = this.ctx('teams.delete', req, id);
    await this.require(actor, 'teams.delete', c);
    await this.db.transaction(async (tx) => {
      await this.one(actor, id, c, tx);
      await tx.delete(teams).where(eq(teams.id, id));
      await this.record(actor, req, 'teams.deleted', id, undefined, tx);
    });
  }

  /** Puts a member of this agency in the team. Already in it: nothing changes. */
  async addMember(
    actor: Actor,
    id: string,
    membershipId: string,
    req: RequestContext,
  ): Promise<TeamView> {
    const c = this.ctx('teams.add_member', req, id);
    await this.require(actor, 'teams.update', c);
    return this.db.transaction(async (tx) => {
      await this.one(actor, id, c, tx);
      const [member] = await tx
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.id, membershipId),
            eq(tenantMemberships.tenantId, THIS_WORKSPACE),
            ne(tenantMemberships.status, 'REMOVED'),
          ),
        );
      if (member === undefined) {
        throw AppError.validation([
          {
            field: 'membershipId',
            code: 'UNKNOWN',
            messageKey: 'error.validation.teams.member_unknown',
          },
        ]);
      }
      const added = await tx
        .insert(teamMembers)
        .values({ teamId: id, membershipId })
        .onConflictDoNothing()
        .returning();
      if (added.length > 0) {
        await this.record(actor, req, 'teams.member_added', id, membershipId, tx);
      }
      return this.one(actor, id, c, tx);
    });
  }

  /** Takes a member out of the team. Not in it: nothing changes. */
  async removeMember(
    actor: Actor,
    id: string,
    membershipId: string,
    req: RequestContext,
  ): Promise<TeamView> {
    const c = this.ctx('teams.remove_member', req, id);
    await this.require(actor, 'teams.update', c);
    return this.db.transaction(async (tx) => {
      await this.one(actor, id, c, tx);
      const removed = await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, id), eq(teamMembers.membershipId, membershipId)))
        .returning();
      if (removed.length > 0) {
        await this.record(actor, req, 'teams.member_removed', id, membershipId, tx);
      }
      return this.one(actor, id, c, tx);
    });
  }

  /** A team of this workspace, with its members — or the same 404 as a team that is not there. */
  private async one(actor: Actor, id: string, c: AuthzContext, db: Db | Tx): Promise<TeamView> {
    const [found] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.tenantId, THIS_WORKSPACE)));
    const row = await this.authz.visible(actor, found, c);
    return (await this.views([row], db))[0]!;
  }

  private async views(rows: Array<typeof teams.$inferSelect>, db: Db | Tx): Promise<TeamView[]> {
    if (rows.length === 0) return [];
    const members = await db
      .select({
        teamId: teamMembers.teamId,
        membershipId: tenantMemberships.id,
        userId: tenantMemberships.userId,
        status: tenantMemberships.status,
        email: users.email,
        displayName: users.displayName,
      })
      .from(teamMembers)
      .innerJoin(tenantMemberships, eq(tenantMemberships.id, teamMembers.membershipId))
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        inArray(
          teamMembers.teamId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(users.email));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.createdAt,
      members: members
        .filter((m) => m.teamId === r.id)
        .map(({ teamId: _team, status, ...m }) => ({
          ...m,
          // A removed member is never in a team (migration 0029).
          status: status as TeamMemberView['status'],
        })),
    }));
  }

  private async require(
    actor: Actor,
    permission: 'teams.read' | 'teams.create' | 'teams.update' | 'teams.delete',
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
    teamId: string,
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
        resourceType: 'team',
        resourceId: teamId,
        reason,
      },
      tx,
    );
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'team',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

const nameLength = (): AppError =>
  AppError.validation([
    { field: 'name', code: 'LENGTH', messageKey: 'error.validation.teams.name_length' },
  ]);

/** Two teams of one agency are never called the same: the unique index, said as the reader's. */
async function nameTaken<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const pg = (e as { cause?: unknown }).cause ?? e;
    const { code, constraint_name } = pg as { code?: string; constraint_name?: string };
    if (code === '23505' && constraint_name === 'teams_tenant_name_unique') {
      throw AppError.conflictOn('name', 'TAKEN', 'error.validation.teams.name_taken');
    }
    throw e;
  }
}
