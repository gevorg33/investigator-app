import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type Db } from '../../database/database.module';
import { userRoles, userSessions, userStaffScopes, users } from '../../database/schema';
import { AppError } from '../errors/app-error';
import { TokenService } from '../../modules/auth/token.service';
import { SessionService } from '../../modules/auth/session.service';
import type { Actor, Role, StaffScope } from './contract';
import { ROLES } from './scopes';

const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);

/**
 * Statuses under which a session stops existing, rather than merely being limited.
 *
 * Suspension is an enforcement action; one that left the offender's existing session
 * rotating for up to REFRESH_TTL_DAYS would not be one. PENDING_VERIFICATION is absent on
 * purpose — login admits an unverified account, so ending its session here would sign
 * people out for no reason. Whether an unverified account may perform a given action is
 * AuthzService.requireActive, which is stricter and demands ACTIVE.
 *
 * The matching revocation of the rows happens on the refresh path (AuthService), so the
 * sessions are actually ended rather than merely refused once per call site.
 */
const SESSION_ENDING_STATUSES: readonly string[] = ['SUSPENDED', 'DELETED'];

@Injectable()
export class ActorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Checks 1 and 2 of the six: a live session, and the account behind it.
   *
   * Roles and staff scopes are read per request rather than carried in the token. That is
   * the reason a role change or a revoked staff scope takes effect on the next request
   * instead of whenever the holder happens to sign in again — the same argument that made
   * the session token opaque in T-005.
   *
   * @param requestedRole the role the caller wishes to act as, if narrowing.
   */
  async fromRefreshToken(refreshToken: string, requestedRole?: string): Promise<Actor> {
    if (!refreshToken) throw new AppError('UNAUTHENTICATED');

    const session = await this.db.query.userSessions.findFirst({
      where: eq(userSessions.refreshTokenHash, this.tokens.fingerprint(refreshToken)),
    });
    if (!session || !this.sessions.isUsable(session)) throw new AppError('UNAUTHENTICATED');

    const user = await this.db.query.users.findFirst({
      where: and(eq(users.id, session.userId), isNull(users.deletedAt)),
    });
    if (!user) throw new AppError('UNAUTHENTICATED');
    // Check 2, at the session level.
    if (SESSION_ENDING_STATUSES.includes(user.status)) throw new AppError('UNAUTHENTICATED');

    const roleRows = await this.db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, user.id), isNull(userRoles.revokedAt)));
    const roles = roleRows.map((r) => r.role).filter(isRole);

    // Only read for a staff account. A non-staff actor has no scopes by construction
    // rather than by an empty query, so a stray row could never become authority.
    let staffScopes: StaffScope[] = [];
    if (roles.includes('STAFF')) {
      const scopeRows = await this.db
        .select()
        .from(userStaffScopes)
        .where(and(eq(userStaffScopes.userId, user.id), isNull(userStaffScopes.revokedAt)));
      staffScopes = scopeRows.map((r) => r.scope);
    }

    return Object.freeze({
      userId: user.id,
      sessionId: session.id,
      status: user.status,
      roles: Object.freeze(roles),
      staffScopes: Object.freeze(staffScopes),
      // The narrowing rule, in one line: intersect, never union. A caller naming a role
      // it does not hold gets undefined — no narrowing — and never the role itself.
      activeRole:
        isRole(requestedRole) && roles.includes(requestedRole) ? requestedRole : undefined,
    });
  }
}
