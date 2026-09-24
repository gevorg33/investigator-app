import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { auditLogs, users } from '../../database/schema';
import { AccountService } from './account.service';

describe('the signed-in account (T-127)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: AccountService;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    const db = scopedDb(sql);
    service = asRequests(new AccountService(db, new AuditService(db)), owner);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const req = () => ({ correlationId: randomUUID(), ip: '203.0.113.4', userAgent: 'spec' });
  const row = async (id: string) =>
    (await ownerDb.select().from(users).where(eq(users.id, id)))[0]!;

  it('describes the caller, their roles and preferences — and whether the address is confirmed', async () => {
    const { actor } = await member(owner, { roles: ['CUSTOMER', 'INVESTIGATOR'] });
    const view = await service.me({ ...actor, activeRole: 'INVESTIGATOR' });
    expect(view).toEqual({
      id: actor.userId,
      email: (await row(actor.userId)).email,
      displayName: null,
      emailVerified: false,
      roles: ['CUSTOMER', 'INVESTIGATOR'],
      activeRole: 'INVESTIGATOR',
      locale: 'en',
      timezone: 'UTC',
    });
    await ownerDb
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, actor.userId));
    expect((await service.me(actor)).emailVerified).toBe(true);
    expect((await service.me(actor)).activeRole).toBeNull();
  });

  it('saves the caller’s own preferences, audits what changed, and touches nobody else', async () => {
    const { actor } = await member(owner);
    const { actor: bystander } = await member(owner);
    const r = req();
    const view = await service.updatePreferences(
      actor,
      { locale: 'hy', timezone: 'Asia/Yerevan' },
      r,
    );
    expect(view).toMatchObject({ locale: 'hy', timezone: 'Asia/Yerevan' });
    expect(await row(actor.userId)).toMatchObject({ locale: 'hy', timezone: 'Asia/Yerevan' });
    expect(await row(bystander.userId)).toMatchObject({ locale: 'en', timezone: 'UTC' });

    const audit = await ownerDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.correlationId, r.correlationId));
    expect(audit.map((a) => [a.action, a.actorId, a.resourceId, a.reason])).toEqual([
      [
        'account.preferences_updated',
        actor.userId,
        actor.userId,
        'locale=hy, timezone=Asia/Yerevan',
      ],
    ]);
  });

  it('changes only what was sent, and records nothing when nothing was', async () => {
    const { actor } = await member(owner);
    await service.updatePreferences(actor, { timezone: 'Europe/Moscow' }, req());
    expect(await row(actor.userId)).toMatchObject({ locale: 'en', timezone: 'Europe/Moscow' });

    const r = req();
    await service.updatePreferences(actor, {}, r);
    expect(
      await ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, r.correlationId)),
    ).toEqual([]);
  });

  it('answers “not signed in” for an account that is gone', async () => {
    const ghost: Actor = { ...(await member(owner)).actor, userId: randomUUID() };
    await expect(service.me(ghost)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
