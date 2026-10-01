import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { WorkspaceResolver } from '../../common/context/workspace.resolver';
import { AppError } from '../../common/errors/app-error';
import { NotificationsService, PAGE_SIZE } from './notifications.service';
import { unsubscribeToken } from './unsubscribe';

/**
 * The notification centre, preferences and unsubscribe, through the service, against the real
 * database (T-036). That nobody reads another person's notifications is held underneath, by the
 * isolation matrix; here is what the service adds — paging, counts, marking, defaults, the audit
 * trail, and what an unsubscribe link can and cannot do.
 */
describe('notifications', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let service: NotificationsService;
  const req = () => ({ ip: '198.51.100.36', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    vi.stubEnv('SESSION_SECRET', 's'.repeat(32));
    sql = testPool();
    owner = testPool({ role: 'owner' });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    service = asRequests(
      new NotificationsService(db, authz, audit, new WorkspaceResolver(db, authz)),
      owner,
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await sql.end();
    await owner.end();
  });

  /** A person with `n` notifications in their Personal workspace, the newest last. */
  const withNotifications = async (n: number, createdAt?: Date) => {
    const { actor, personalId } = await member(owner);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [row] = await owner<{ id: string }[]>`
        INSERT INTO notifications
          (tenant_id, recipient_id, event_id, kind, subject_type, subject_id, href, created_at)
        VALUES (${personalId}, ${actor.userId}, ${randomUUID()}, 'mission_published', 'mission',
                ${randomUUID()}, '/missions', ${createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, i))})
        RETURNING id`;
      ids.push(row!.id);
    }
    return { actor, personalId, ids };
  };

  const membershipOf = async (userId: string, tenantId: string) => {
    const [row] = await owner<{ id: string }[]>`
      SELECT id FROM tenant_memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
    return row!.id;
  };

  // What the rows say, in a fixed order — not when: `occurred_at` is the writing transaction's
  // start, so rows written together tie and a clock step reorders separate ones, and the table has no
  // write-order column. The audit claims which events were recorded, not their sequence (T-180).
  const auditOf = (userId: string) => owner<{ action: string; reason: string | null }[]>`
    SELECT action, reason FROM audit_logs WHERE actor_id = ${userId}
      AND action LIKE 'notifications.%' ORDER BY action, reason`;

  describe('the centre', () => {
    it('lists newest first, a page at a time, with a cursor to the next', async () => {
      const { actor, ids } = await withNotifications(PAGE_SIZE + 3);
      const first = await service.list(actor, undefined, req());
      expect(first.items.map((n) => n.id)).toEqual([...ids].reverse().slice(0, PAGE_SIZE));
      expect(first.items[0]).toMatchObject({
        kind: 'mission_published',
        subjectType: 'mission',
        href: '/missions',
        readAt: null,
      });
      const second = await service.list(actor, first.nextCursor!, req());
      expect(second.items.map((n) => n.id)).toEqual([...ids].reverse().slice(PAGE_SIZE));
      expect(second.nextCursor).toBeNull();
    });

    it('pages rows written in the same millisecond by id, skipping none', async () => {
      const { actor, ids } = await withNotifications(
        PAGE_SIZE + 2,
        new Date('2026-02-01T00:00:00.123Z'),
      );
      const first = await service.list(actor, undefined, req());
      const second = await service.list(actor, first.nextCursor!, req());
      const seen = [...first.items, ...second.items].map((n) => n.id);
      expect(new Set(seen).size).toBe(PAGE_SIZE + 2);
      expect(seen.sort()).toEqual([...ids].sort());
    });

    it('refuses a cursor it did not write', async () => {
      const { actor } = await withNotifications(0);
      const bad = (text: string) => Buffer.from(text).toString('base64url');
      for (const cursor of ['nonsense', bad('2026-01-01|x'), bad(`not a date|${randomUUID()}`)]) {
        const error = await service.list(actor, cursor, req()).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).details).toEqual([
          { field: 'cursor', code: 'INVALID', messageKey: 'error.validation.cursor.invalid' },
        ]);
      }
    });

    it('counts the unread, marks one read, then the rest', async () => {
      const { actor, ids } = await withNotifications(3);
      expect(await service.unread(actor, req())).toBe(3);
      await service.markRead(actor, ids[0]!, req());
      await service.markRead(actor, ids[0]!, req());
      expect(await service.unread(actor, req())).toBe(2);
      const [first] = await owner<{ read_at: Date }[]>`
        SELECT read_at FROM notifications WHERE id = ${ids[0]!}`;
      await service.markAllRead(actor, req());
      expect(await service.unread(actor, req())).toBe(0);
      const [still] = await owner<{ read_at: Date }[]>`
        SELECT read_at FROM notifications WHERE id = ${ids[0]!}`;
      expect(still!.read_at).toEqual(first!.read_at);
    });

    it('answers another person’s notification exactly as one that does not exist', async () => {
      const mine = await withNotifications(1);
      const theirs = await withNotifications(1);
      for (const id of [theirs.ids[0]!, randomUUID()]) {
        const error = await service.markRead(mine.actor, id, req()).catch((e: unknown) => e);
        expect((error as AppError).code).toBe('NOT_FOUND');
      }
      expect(await service.unread(theirs.actor, req())).toBe(1);
      expect((await service.list(mine.actor, undefined, req())).items.map((n) => n.id)).toEqual(
        mine.ids,
      );
    });

    it('refuses a suspended account', async () => {
      const { actor } = await withNotifications(1);
      const suspended: Actor = { ...actor, status: 'SUSPENDED' };
      await expect(service.unread(suspended, req())).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('preferences', () => {
    it('defaults every category to on, and records a change', async () => {
      const { actor } = await withNotifications(0);
      expect(await service.preferences(actor, req())).toEqual([
        { category: 'activity', channel: 'email', enabled: true },
      ]);
      const off = { category: 'activity', channel: 'email', enabled: false } as const;
      expect(await service.setPreference(actor, off, req())).toEqual([off]);
      expect(await service.setPreference(actor, { ...off, enabled: true }, req())).toEqual([
        { ...off, enabled: true },
      ]);
      expect(await auditOf(actor.userId)).toEqual([
        { action: 'notifications.preference_changed', reason: 'activity:email:off' },
        { action: 'notifications.preference_changed', reason: 'activity:email:on' },
      ]);
    });
  });

  describe('unsubscribing by link', () => {
    const secret = () => process.env['SESSION_SECRET']!;

    it('turns the category off for the person it names, in the workspace it names', async () => {
      const { actor, personalId } = await withNotifications(0);
      await owner`UPDATE users SET locale = 'hy' WHERE id = ${actor.userId}`;
      const token = unsubscribeToken(
        {
          userId: actor.userId,
          tenantId: personalId,
          membershipId: await membershipOf(actor.userId, personalId),
          category: 'activity',
        },
        secret(),
      );
      expect(await service.localeFor(token)).toBe('hy');
      expect(await service.unsubscribe(token, req())).toBe('done');
      expect(await service.unsubscribe(token, req())).toBe('done');
      expect(await service.preferences(actor, req())).toEqual([
        { category: 'activity', channel: 'email', enabled: false },
      ]);
      expect((await auditOf(actor.userId)).map((a) => a.action)).toEqual([
        'notifications.unsubscribed',
        'notifications.unsubscribed',
      ]);
    });

    it('does nothing for a link that is not ours', async () => {
      const { actor, personalId } = await withNotifications(0);
      const target = {
        userId: actor.userId,
        tenantId: personalId,
        membershipId: await membershipOf(actor.userId, personalId),
        category: 'activity' as const,
      };
      for (const token of [undefined, 'x.y', unsubscribeToken(target, 'another secret')]) {
        expect(await service.unsubscribe(token, req())).toBe('invalid');
        expect(await service.localeFor(token)).toBeUndefined();
      }
      expect(await auditOf(actor.userId)).toEqual([]);
    });

    it('does nothing once its person has no place in that workspace', async () => {
      const { actor, personalId } = await withNotifications(0);
      const token = unsubscribeToken(
        {
          userId: actor.userId,
          tenantId: personalId,
          membershipId: randomUUID(),
          category: 'activity',
        },
        secret(),
      );
      expect(await service.unsubscribe(token, req())).toBe('invalid');
      expect(await service.preferences(actor, req())).toEqual([
        { category: 'activity', channel: 'email', enabled: true },
      ]);
    });
  });
});
