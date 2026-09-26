import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { currentContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { MAILER, type Mailer } from '../../../common/mail/mailer';
import { DB, type Db, type Tx } from '../../../database/database.module';
import { tenantInvitations, tenantMemberships, tenants, users } from '../../../database/schema';
import { RateLimitService } from '../../auth/rate-limit.service';
import { TokenService } from '../../auth/token.service';
import { EmployeeRoles } from './employee-roles';
import type { InviteEmployeeDto } from './employees.dto';
import { conflict } from './members.service';

/** How long a link works. Resending starts it again. */
export const INVITATION_TTL_DAYS = 7;

export interface InvitationView {
  id: string;
  email: string;
  /** The catalog's key of the role it grants, for display. */
  role: string;
  /** EXPIRED is derived: a PENDING invitation past `expiresAt`. */
  status: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'CANCELLED';
  expiresAt: Date;
  invitedAt: Date;
  lastSentAt: Date;
  sentCount: number;
  acceptedAt: Date | null;
}

/** What accepting gives the new member: the workspace to switch to. */
export interface AcceptedInvitation {
  workspaceId: string;
  name: string;
}

const THIS_WORKSPACE = sql`app_current_tenant()`;

/**
 * Inviting people into an agency, and their accepting (T-085, tenancy.md §2).
 *
 * An invitation is an address, the one role it grants, and a single-use token whose hash is all
 * that is stored. Resending issues a new token, so the old link stops working; cancelling ends it.
 * Accepting needs the account with that address, confirmed — which the database checks as well:
 * the invitee's policies key on their account's confirmed email, never on the request — and it
 * creates the membership, or brings a removed one back, with the invitation's role.
 *
 * Every invitation and resend is an email, so both count against the workspace's limit.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly roles: EmployeeRoles,
    private readonly tokens: TokenService,
    private readonly limits: RateLimitService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async list(actor: Actor, req: RequestContext): Promise<InvitationView[]> {
    await this.require(actor, 'employees.read', this.ctx('employees.invitations.list', req));
    const rows = await this.db
      .select()
      .from(tenantInvitations)
      .where(eq(tenantInvitations.tenantId, THIS_WORKSPACE))
      .orderBy(desc(tenantInvitations.createdAt))
      .limit(200);
    return this.views(rows);
  }

  async invite(actor: Actor, dto: InviteEmployeeDto, req: RequestContext): Promise<InvitationView> {
    const c = this.ctx('employees.invite', req);
    await this.require(actor, 'employees.invite', c);
    const [role] = await this.roles.byKeys([dto.role]);
    if (role === undefined) {
      throw AppError.validation([
        { field: 'role', code: 'UNKNOWN', messageKey: 'error.validation.employees.role_unknown' },
      ]);
    }
    await this.authz.requireHoldsAll(actor, role.permissions, c);
    await this.limits.consume('invitationsPerWorkspace', currentContext()!.tenantId);

    const token = this.tokens.issue();
    const created = await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ status: tenantMemberships.status })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .where(
          and(
            eq(tenantMemberships.tenantId, THIS_WORKSPACE),
            eq(users.email, dto.email),
            inArray(tenantMemberships.status, ['ACTIVE', 'SUSPENDED']),
          ),
        );
      if (member !== undefined) {
        throw conflict('email', 'MEMBER', 'error.validation.employees.already_member');
      }
      const [pending] = await tx
        .select()
        .from(tenantInvitations)
        .where(
          and(
            eq(tenantInvitations.tenantId, THIS_WORKSPACE),
            eq(tenantInvitations.email, dto.email),
            eq(tenantInvitations.status, 'PENDING'),
          ),
        )
        .for('update');
      if (pending !== undefined && pending.expiresAt > new Date()) {
        throw conflict('email', 'INVITED', 'error.validation.employees.already_invited');
      }
      if (pending !== undefined) {
        // Expired: it is replaced, so the address has one live invitation, not two.
        await tx
          .update(tenantInvitations)
          .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(tenantInvitations.id, pending.id));
      }
      const [row] = await tx
        .insert(tenantInvitations)
        .values({
          email: dto.email,
          roleId: role.id,
          tokenHash: this.tokens.fingerprint(token),
          expiresAt: expiry(),
          invitedBy: actor.userId,
        })
        .returning();
      await this.record(actor, req, 'employees.invited', row!.id, role.key, tx);
      return row!;
    });
    await this.send(created.email, token);
    return (await this.views([created]))[0]!;
  }

  /** A new token and a new week; the old link stops working. */
  async resend(actor: Actor, id: string, req: RequestContext): Promise<InvitationView> {
    const c = this.ctx('employees.invitation.resend', req, id);
    await this.require(actor, 'employees.invite', c);
    const token = this.tokens.issue();
    const updated = await this.db.transaction(async (tx) => {
      const row = await this.pending(actor, id, c, tx);
      const role = (await this.roles.byId(row.roleId, tx))!;
      await this.authz.requireHoldsAll(actor, role.permissions, c);
      await this.limits.consume('invitationsPerWorkspace', currentContext()!.tenantId);
      const now = new Date();
      const [next] = await tx
        .update(tenantInvitations)
        .set({
          tokenHash: this.tokens.fingerprint(token),
          expiresAt: expiry(now),
          sentCount: row.sentCount + 1,
          lastSentAt: now,
          updatedAt: now,
        })
        .where(eq(tenantInvitations.id, row.id))
        .returning();
      await this.record(actor, req, 'employees.invitation_resent', row.id, undefined, tx);
      return next!;
    });
    await this.send(updated.email, token);
    return (await this.views([updated]))[0]!;
  }

  async cancel(actor: Actor, id: string, req: RequestContext): Promise<InvitationView> {
    const c = this.ctx('employees.invitation.cancel', req, id);
    await this.require(actor, 'employees.invite', c);
    const updated = await this.db.transaction(async (tx) => {
      const row = await this.pending(actor, id, c, tx);
      const [next] = await tx
        .update(tenantInvitations)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(tenantInvitations.id, row.id))
        .returning();
      await this.record(actor, req, 'employees.invitation_cancelled', row.id, undefined, tx);
      return next!;
    });
    return (await this.views([updated]))[0]!;
  }

  /**
   * Accepting, as the invitee, from whatever workspace they are in. What they can see of the
   * invitation, and what they may write because of it, is decided by the database from their
   * account's confirmed address: another account, a used or cancelled invitation, an expired one
   * and a token that was never issued all look the same — not found.
   */
  async accept(actor: Actor, token: string, req: RequestContext): Promise<AcceptedInvitation> {
    const c: AuthzContext = {
      action: 'employees.invitation.accept',
      resourceType: 'tenant_invitation',
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
    await this.authz.requireActive(actor, c);
    const hash = this.tokens.fingerprint(token);
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(tenantInvitations)
        .where(
          and(
            eq(tenantInvitations.tokenHash, hash),
            eq(tenantInvitations.status, 'PENDING'),
            sql`${tenantInvitations.expiresAt} > now()`,
          ),
        )
        .for('update');
      // Inside the agency's own workspace its members can see every invitation; only the one
      // addressed to this account is theirs to accept (the database refuses the rest anyway).
      const [me] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, actor.userId));
      const mine = found !== undefined && found.email.toLowerCase() === me!.email.toLowerCase();
      const invitation = await this.authz.visible(actor, mine ? found : undefined, c);

      const [existing] = await tx
        .select({ id: tenantMemberships.id, status: tenantMemberships.status })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, invitation.tenantId),
            eq(tenantMemberships.userId, actor.userId),
          ),
        );
      if (existing?.status === 'ACTIVE') {
        throw conflict('token', 'MEMBER', 'error.validation.employees.already_member');
      }
      // Suspension is the agency's to reverse, not something an invitation gets round.
      if (existing?.status === 'SUSPENDED') {
        throw conflict('token', 'SUSPENDED', 'error.validation.employees.suspended');
      }
      let membershipId: string;
      if (existing === undefined) {
        const [created] = await tx
          .insert(tenantMemberships)
          .values({
            tenantId: invitation.tenantId,
            tenantKind: 'AGENCY',
            userId: actor.userId,
            status: 'ACTIVE',
          })
          .returning({ id: tenantMemberships.id });
        membershipId = created!.id;
      } else {
        await tx
          .update(tenantMemberships)
          .set({ status: 'ACTIVE', updatedAt: new Date() })
          .where(eq(tenantMemberships.id, existing.id));
        membershipId = existing.id;
      }
      await this.roles.grant(membershipId, invitation.roleId, tx);
      // No RETURNING: once accepted, the row is no longer the invitee's to read.
      await tx
        .update(tenantInvitations)
        .set({
          status: 'ACCEPTED',
          acceptedBy: actor.userId,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tenantInvitations.id, invitation.id));
      await this.audit.record(
        {
          correlationId: req.correlationId,
          ipAddress: req.ip,
          userAgent: req.userAgent,
          actorId: actor.userId,
          action: 'employees.invitation_accepted',
          resourceType: 'tenant_invitation',
          resourceId: invitation.id,
        },
        tx,
      );
      const [agency] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, invitation.tenantId));
      return { workspaceId: invitation.tenantId, name: agency!.name! };
    });
  }

  /** A pending invitation of this workspace — expired or not — locked for the change. */
  private async pending(actor: Actor, id: string, c: AuthzContext, tx: Tx) {
    const [found] = await tx
      .select()
      .from(tenantInvitations)
      .where(and(eq(tenantInvitations.id, id), eq(tenantInvitations.tenantId, THIS_WORKSPACE)))
      .for('update');
    const row = await this.authz.visible(actor, found, c);
    await this.authz.stateAllows(actor, row.status === 'PENDING', c);
    return row;
  }

  /** The email: a link carrying the token, and the agency's name. The token goes nowhere else. */
  private async send(email: string, token: string): Promise<void> {
    const [agency] = await this.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, THIS_WORKSPACE));
    await this.mailer.send({
      to: email,
      template: 'workspace_invitation',
      variables: {
        workspace: agency!.name!,
        url: `${process.env['APP_BASE_URL'] ?? 'http://localhost:3000'}/invitations/accept?token=${token}`,
      },
    });
  }

  private async views(
    rows: Array<typeof tenantInvitations.$inferSelect>,
  ): Promise<InvitationView[]> {
    const keys = new Map<string, string>();
    for (const id of new Set(rows.map((r) => r.roleId))) {
      keys.set(id, (await this.roles.byId(id))!.key);
    }
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: keys.get(r.roleId)!,
      status: r.status === 'PENDING' && r.expiresAt <= now ? 'EXPIRED' : r.status,
      expiresAt: r.expiresAt,
      invitedAt: r.createdAt,
      lastSentAt: r.lastSentAt,
      sentCount: r.sentCount,
      acceptedAt: r.acceptedAt,
    }));
  }

  private async require(
    actor: Actor,
    permission: 'employees.read' | 'employees.invite',
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
    invitationId: string,
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
        resourceType: 'tenant_invitation',
        resourceId: invitationId,
        reason,
      },
      tx,
    );
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'tenant_invitation',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

const expiry = (from = new Date()): Date =>
  new Date(from.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
