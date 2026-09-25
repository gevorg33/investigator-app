import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { users, type KnowledgeLocale } from '../../database/schema';

/** The signed-in account as the application renders it (T-127). */
export interface AccountView {
  id: string;
  email: string;
  displayName: string | null;
  /** False until the address is confirmed. Sign-in works regardless; some actions do not. */
  emailVerified: boolean;
  roles: Actor['roles'];
  /** The role this request acts as, when narrowed with `X-Active-Role`; otherwise null. */
  activeRole: Actor['activeRole'] | null;
  locale: string;
  timezone: string;
}

/**
 * The caller's own account — found by who is asking, never by an id they send (`authorization`:
 * a model- or client-supplied user id is an impersonation vector).
 *
 * `users` has no row-level security (tenancy.md: identity rows are read before any workspace
 * exists), so the `WHERE id = actor` here is the whole boundary. There is no other path in.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async me(actor: Actor): Promise<AccountView> {
    const [row] = await this.db.select().from(users).where(eq(users.id, actor.userId));
    // The guard resolved this actor from a live session a moment ago; a missing row means the
    // account went between the two reads, and the caller is no longer signed in as anyone.
    if (row === undefined) throw new AppError('UNAUTHENTICATED');
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      emailVerified: row.emailVerifiedAt !== null,
      roles: actor.roles,
      activeRole: actor.activeRole ?? null,
      locale: row.locale,
      timezone: row.timezone,
    };
  }

  /**
   * Saves the language and time zone the application uses for this person. Deliberately open to
   * an account awaiting email verification: a reader must be able to switch language before they
   * can do anything else. The guard has already refused a suspended or deleted account.
   */
  async updatePreferences(
    actor: Actor,
    changes: { locale?: KnowledgeLocale | undefined; timezone?: string | undefined },
    req: RequestContext,
  ): Promise<AccountView> {
    const set = {
      ...(changes.locale !== undefined ? { locale: changes.locale } : {}),
      ...(changes.timezone !== undefined ? { timezone: changes.timezone } : {}),
    };
    if (Object.keys(set).length > 0) {
      await this.db
        .update(users)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(users.id, actor.userId));
      await this.audit.record({
        correlationId: req.correlationId,
        actorId: actor.userId,
        action: 'account.preferences_updated',
        resourceType: 'user',
        resourceId: actor.userId,
        // Which preferences, and their new values: a language and a time zone are not personal
        // data worth withholding from the audit trail, and they explain a later complaint.
        reason: Object.entries(set)
          .map(([k, v]) => `${k}=${v}`)
          .join(', '),
        ipAddress: req.ip,
        userAgent: req.userAgent,
      });
    }
    return this.me(actor);
  }
}
