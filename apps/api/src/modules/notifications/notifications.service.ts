import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { runInContext } from '../../common/context/execution-context';
import { WorkspaceResolver } from '../../common/context/workspace.resolver';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { notificationPreferences, notifications, users } from '../../database/schema';
import type { NotificationCategory, NotificationKind } from './kinds';
import { readUnsubscribeToken } from './unsubscribe';

export const PAGE_SIZE = 20;

/**
 * Ordered and compared at the cursor's own precision (docs/api/pagination.md): PostgreSQL keeps
 * microseconds, a cursor's Date keeps milliseconds, and compared directly a newest-first list skips
 * rows between pages.
 */
const createdMs = sql`date_trunc('milliseconds', ${notifications.createdAt})`;

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  subjectType: string;
  subjectId: string;
  href: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface Preference {
  category: NotificationCategory;
  channel: 'email';
  enabled: boolean;
}

/** Every preference a person has, defaults included: the one stoppable category, by email. */
const DEFAULTS: readonly Preference[] = [{ category: 'activity', channel: 'email', enabled: true }];

const cursorOf = (n: { createdAt: Date; id: string }) =>
  Buffer.from(`${n.createdAt.toISOString()}|${n.id}`).toString('base64url');

function readCursor(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const parts = /^([^|]+)\|([0-9a-f-]{36})$/i.exec(
    Buffer.from(cursor, 'base64url').toString('utf8'),
  );
  const createdAt = parts === null ? undefined : new Date(parts[1]!);
  if (createdAt === undefined || Number.isNaN(createdAt.getTime())) {
    throw AppError.validation([
      { field: 'cursor', code: 'INVALID', messageKey: 'error.validation.cursor.invalid' },
    ]);
  }
  return { createdAt, id: parts![2]! };
}

/**
 * The in-app notification centre and its preferences (T-036). Everything here is the caller's own,
 * in the workspace the request is in: row-level security shows a person their notifications and
 * nobody else's — not even another member of the same agency.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly resolver: WorkspaceResolver,
  ) {}

  /** Newest first, a page at a time. */
  async list(
    actor: Actor,
    cursor: string | undefined,
    req: RequestContext,
  ): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
    await this.authz.requireActive(actor, this.ctx('notifications.list', req));
    const after = readCursor(cursor);
    const rows = await this.db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        subjectType: notifications.subjectType,
        subjectId: notifications.subjectId,
        href: notifications.href,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(
        after === undefined
          ? undefined
          : or(
              lt(createdMs, sql`${after.createdAt.toISOString()}::timestamptz`),
              and(
                eq(createdMs, sql`${after.createdAt.toISOString()}::timestamptz`),
                lt(notifications.id, after.id),
              ),
            ),
      )
      .orderBy(desc(createdMs), desc(notifications.id))
      .limit(PAGE_SIZE + 1);
    const items = rows.slice(0, PAGE_SIZE) as NotificationView[];
    return {
      items,
      nextCursor: rows.length > PAGE_SIZE ? cursorOf(items[items.length - 1]!) : null,
    };
  }

  async unread(actor: Actor, req: RequestContext): Promise<number> {
    await this.authz.requireActive(actor, this.ctx('notifications.unread', req));
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(isNull(notifications.readAt));
    return row!.n;
  }

  /** Marks one read. Another person's id reads exactly like one that does not exist. */
  async markRead(actor: Actor, id: string, req: RequestContext): Promise<void> {
    const c = this.ctx('notifications.read', req, id);
    await this.authz.requireActive(actor, c);
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(eq(notifications.id, id))
      .returning({ id: notifications.id });
    if (row === undefined) throw new AppError('NOT_FOUND');
  }

  async markAllRead(actor: Actor, req: RequestContext): Promise<void> {
    await this.authz.requireActive(actor, this.ctx('notifications.read_all', req));
    await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(isNull(notifications.readAt));
  }

  async preferences(actor: Actor, req: RequestContext): Promise<Preference[]> {
    await this.authz.requireActive(actor, this.ctx('notifications.preferences', req));
    const chosen = await this.db.select().from(notificationPreferences);
    return DEFAULTS.map((d) => ({
      ...d,
      enabled:
        chosen.find((c) => c.category === d.category && c.channel === d.channel)?.enabled ??
        d.enabled,
    }));
  }

  async setPreference(
    actor: Actor,
    choice: Preference,
    req: RequestContext,
  ): Promise<Preference[]> {
    const c = this.ctx('notifications.preference_changed', req);
    await this.authz.requireActive(actor, c);
    await this.choose(choice);
    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: actor.userId,
      action: 'notifications.preference_changed',
      resourceType: 'notification_preference',
      reason: `${choice.category}:${choice.channel}:${choice.enabled ? 'on' : 'off'}`,
    });
    return this.preferences(actor, req);
  }

  /**
   * Stops a category of email from an unsubscribe link (T-036), as the person it names — in their
   * workspace, re-read now, exactly as a job restores one. A link that does not verify, or whose
   * person has since left that workspace, does nothing, and says so.
   */
  async unsubscribe(token: unknown, req: RequestContext): Promise<'done' | 'invalid'> {
    const target = readUnsubscribeToken(token, process.env['SESSION_SECRET']!);
    if (target === null) return 'invalid';
    const context = await this.resolver.forJob(target);
    if (context === undefined) return 'invalid';
    await runInContext(context, async () => {
      await this.choose({ category: target.category, channel: 'email', enabled: false });
      await this.audit.record({
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: target.userId,
        action: 'notifications.unsubscribed',
        resourceType: 'notification_preference',
        reason: `${target.category}:email`,
      });
    });
    return 'done';
  }

  /** The language an unsubscribe page speaks: its person's, when the link is genuine. */
  async localeFor(token: unknown): Promise<string | undefined> {
    const target = readUnsubscribeToken(token, process.env['SESSION_SECRET']!);
    if (target === null) return undefined;
    const [person] = await this.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, target.userId));
    return person?.locale;
  }

  private async choose(choice: Preference): Promise<void> {
    await this.db
      .insert(notificationPreferences)
      .values({ category: choice.category, channel: choice.channel, enabled: choice.enabled })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.tenantId,
          notificationPreferences.userId,
          notificationPreferences.category,
          notificationPreferences.channel,
        ],
        set: { enabled: choice.enabled, updatedAt: new Date() },
      });
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'notification',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}
