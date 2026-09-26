import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { agencyContext, personalContext, scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { runInContext, type ExecutionContext } from '../../common/context/execution-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import * as schema from '../../database/schema';
import { auditLogs, tenants } from '../../database/schema';
import { LegalService } from '../legal/legal.service';
import { AgenciesService } from './agencies.service';

/**
 * Completing or changing an agency's core details (T-150): the owner's alone, versioned, audited
 * by the names of what changed — and the write that completes the minimum is the one that makes a
 * CREATING agency ACTIVE.
 */
describe('agency core details (T-150)', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let agencies: AgenciesService;
  const req = () => ({ ip: '198.51.100.150', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    agencies = new AgenciesService(
      db,
      new AuthzService(audit),
      audit,
      new IdempotencyService(),
      new LegalService(db, audit),
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  interface Member {
    actor: Actor;
    context: ExecutionContext;
  }

  /** An agency with its owner first, then a member per role named. */
  const setUp = async (...roles: string[]) => {
    const people = await Promise.all([undefined, ...roles].map(() => member(ownerSql)));
    const { tenantId } = await agency(
      ownerSql,
      people.map((p, i) => ({ userId: p.actor.userId, ...(i > 0 && { role: roles[i - 1] }) })),
    );
    const members: Member[] = await Promise.all(
      people.map(async (p) => ({
        actor: p.actor,
        context: await agencyContext(ownerSql, p.actor.userId, tenantId),
      })),
    );
    return { tenantId, owner: members[0]!, others: members.slice(1) };
  };

  /** An agency still being set up: no business email and no currency yet. */
  const creating = async (tenantId: string) =>
    ownerSql`UPDATE tenants SET status = 'CREATING', business_email = NULL, currency = NULL
             WHERE id = ${tenantId}`;

  const as = <T>(m: Member, fn: () => Promise<T>) => runInContext(m.context, fn);
  const read = (m: Member) => as(m, () => agencies.readCurrent(m.actor, req()));
  const update = (m: Member, dto: Parameters<AgenciesService['updateCurrent']>[1], r = req()) =>
    as(m, () => agencies.updateCurrent(m.actor, dto, r));
  const stored = async (tenantId: string) =>
    (await ownerDb.select().from(tenants).where(eq(tenants.id, tenantId)))[0]!;
  const audited = (correlationId: string) =>
    ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId));

  it('reads to any member, with the version a change must name', async () => {
    const a = await setUp('VIEWER');
    const row = await stored(a.tenantId);
    expect(await read(a.others[0]!)).toEqual({
      id: a.tenantId,
      name: row.name,
      status: 'ACTIVE',
      countryCode: 'AM',
      businessEmail: row.businessEmail,
      timezone: 'Asia/Yerevan',
      currency: 'AMD',
      missing: [],
      version: 1,
      mayChange: false,
    });
    expect(await read(a.owner)).toMatchObject({ mayChange: true });
  });

  it('says what an agency being set up still needs', async () => {
    const a = await setUp();
    await creating(a.tenantId);
    expect(await read(a.owner)).toMatchObject({
      status: 'CREATING',
      missing: ['businessEmail', 'currency'],
    });
  });

  it('becomes ACTIVE in the write that completes the minimum, and not before', async () => {
    const a = await setUp();
    await creating(a.tenantId);

    const first = req();
    const partial = await update(a.owner, { version: 1, currency: 'USD' }, first);
    expect(partial).toMatchObject({ status: 'CREATING', missing: ['businessEmail'], version: 2 });
    expect((await audited(first.correlationId)).map((e) => e.action)).toEqual([
      'agency.details_updated',
    ]);

    const second = req();
    const done = await update(
      a.owner,
      { version: 2, businessEmail: 'desk@northlight.test' },
      second,
    );
    expect(done).toMatchObject({ status: 'ACTIVE', missing: [], version: 3 });
    expect(await stored(a.tenantId)).toMatchObject({
      status: 'ACTIVE',
      businessEmail: 'desk@northlight.test',
      currency: 'USD',
    });
    const events = await audited(second.correlationId);
    expect(events.map((e) => [e.action, e.reason, e.resourceId])).toEqual([
      ['agency.details_updated', 'businessEmail', a.tenantId],
      ['agency.activated', null, a.tenantId],
    ]);
  });

  it('changes an ACTIVE agency’s details, auditing which changed and never their values', async () => {
    const a = await setUp();
    const r = req();
    const saved = await update(
      a.owner,
      {
        version: 1,
        name: '  Northlight Investigations  ',
        businessEmail: 'office@northlight.test',
        timezone: 'Europe/Moscow',
        countryCode: 'AM',
      },
      r,
    );
    expect(saved).toMatchObject({
      name: 'Northlight Investigations',
      businessEmail: 'office@northlight.test',
      timezone: 'Europe/Moscow',
      status: 'ACTIVE',
      version: 2,
    });
    const [event] = await audited(r.correlationId);
    // The country was sent unchanged, so it is not among what changed.
    expect(event).toMatchObject({
      action: 'agency.details_updated',
      reason: 'name,businessEmail,timezone',
    });
    expect(JSON.stringify(event)).not.toContain('office@northlight.test');
  });

  it('writes nothing, and records nothing, when nothing changes', async () => {
    const a = await setUp();
    const r = req();
    expect(await update(a.owner, { version: 1, countryCode: 'AM' }, r)).toMatchObject({
      version: 1,
    });
    expect(await audited(r.correlationId)).toEqual([]);
  });

  it('refuses a change made against a version since replaced', async () => {
    const a = await setUp();
    await update(a.owner, { version: 1, timezone: 'UTC' });
    await expect(update(a.owner, { version: 1, currency: 'USD' })).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect((await stored(a.tenantId)).currency).toBe('AMD');
  });

  it.each(['ADMIN', 'MANAGER', 'VIEWER'])('is the owner’s alone: %s is refused', async (role) => {
    const a = await setUp(role);
    await creating(a.tenantId);
    await expect(
      update(a.others[0]!, { version: 1, currency: 'USD', businessEmail: 'x@agency.test' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await stored(a.tenantId)).toMatchObject({
      status: 'CREATING',
      currency: null,
      version: 1,
    });
  });

  it('is an agency’s, not a Personal workspace’s, and not a stranger’s', async () => {
    const a = await setUp();
    const { actor } = await member(ownerSql);
    const personal = { actor, context: await personalContext(ownerSql, actor.userId) };
    await expect(read(personal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(update(personal, { version: 1, currency: 'USD' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await stored(a.tenantId)).currency).toBe('AMD');
  });
});
