import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { runInContext, type ExecutionContext } from '../../common/context/execution-context';
import { aiMessages, aiSessions } from '../../database/schema';
import { AiSessionsService } from './ai-sessions.service';

/**
 * Another person cannot reach a session or its messages by any path (T-045).
 *
 * Every route answers a stranger with the same 404 an unknown id gets, so a session id carries no
 * information to anyone but its owner. And inside an agency, a colleague — even the one who owns
 * the agency — is a stranger here: a conversation with the assistant is as private as a draft.
 */
describe('nobody else reaches a conversation', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let raw: AiSessionsService;
  let service: AiSessionsService;
  const req = () => ({ ip: '198.51.100.46', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    raw = new AiSessionsService(db, new AuthzService(audit), audit);
    service = asRequests(raw, owner);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  /** Every way there is to touch one session, as `actor`. */
  const everyPath = (
    s: AiSessionsService,
    actor: Actor,
    id: string,
  ): Array<() => Promise<unknown>> => [
    () => s.open(actor, id, req()),
    () => s.resume(actor, id, req()),
    () => s.messages(actor, id, {}, req()),
    () => s.rename(actor, id, 'Taken over', req()),
    () => s.archive(actor, id, req()),
    () => s.delete(actor, id, req()),
    () => s.append(actor, id, { role: 'USER', content: 'Injected' }, req()),
  ];

  const conversationOf = async (actor: Actor) => {
    const session = await service.create(actor, { title: 'Mine alone' }, req());
    await service.append(actor, session.id, { role: 'USER', content: 'Private detail' }, req());
    return session;
  };

  it('gives another user 404 on every path, and leaves the session untouched', async () => {
    const mine = (await member(owner)).actor;
    const stranger = (await member(owner)).actor;
    const session = await conversationOf(mine);

    for (const attempt of everyPath(service, stranger, session.id)) {
      await expect(attempt()).rejects.toMatchObject({ status: 404 });
    }
    expect((await service.list(stranger, {}, req())).items).toEqual([]);
    expect(await service.search(stranger, 'Private detail', req())).toEqual([]);

    const [still] = await owner<{ title: string; n: number }[]>`
      SELECT s.title, (SELECT count(*)::int FROM ai_messages m WHERE m.session_id = s.id) AS n
        FROM ai_sessions s WHERE s.id = ${session.id}`;
    expect(still).toEqual({ title: 'Mine alone', n: 1 });
  });

  it('keeps a colleague out — even the agency’s owner — inside the same workspace', async () => {
    const boss = (await member(owner)).actor;
    const colleague = (await member(owner)).actor;
    const firm = await agency(owner, [{ userId: boss.userId }, { userId: colleague.userId }]);
    const inFirm = async (actor: Actor): Promise<ExecutionContext> => {
      const [m] = await owner<{ id: string }[]>`
        SELECT id FROM tenant_memberships WHERE tenant_id = ${firm.tenantId} AND user_id = ${actor.userId}`;
      return {
        tenantId: firm.tenantId,
        tenantKind: 'AGENCY',
        userId: actor.userId,
        membershipId: m!.id,
        sessionId: randomUUID(),
        permissions: [],
      };
    };

    const session = await runInContext(await inFirm(colleague), () =>
      raw.create(colleague, { title: 'Working through a case' }, req()),
    );
    const asBoss = await inFirm(boss);
    for (const attempt of everyPath(raw, boss, session.id)) {
      await expect(runInContext(asBoss, attempt)).rejects.toMatchObject({ status: 404 });
    }
    expect((await runInContext(asBoss, () => raw.list(boss, {}, req()))).items).toEqual([]);

    // And underneath the service: the policy alone shows the boss nothing.
    const seen = await runInContext(
      asBoss,
      async () =>
        await scopedDb(sql).select().from(aiSessions).where(eq(aiSessions.id, session.id)),
    );
    expect(seen).toEqual([]);
  });

  it('shows the policy alone keeping a stranger’s query away from the messages', async () => {
    const mine = (await member(owner)).actor;
    const stranger = (await member(owner)).actor;
    const session = await conversationOf(mine);
    const rows = await asRequests(
      {
        read: (_: Actor) =>
          scopedDb(sql)
            .select()
            .from(aiMessages)
            .where(eq(aiMessages.sessionId, session.id))
            .then((r) => r),
      },
      owner,
    ).read(stranger);
    expect(rows).toEqual([]);
  });

  it('refuses a suspended account every path, its own sessions included', async () => {
    const mine = (await member(owner)).actor;
    const session = await conversationOf(mine);
    const suspended = testActor({ ...mine, status: 'SUSPENDED' });
    for (const attempt of everyPath(service, suspended, session.id)) {
      await expect(attempt()).rejects.toMatchObject({ status: 403 });
    }
    await expect(service.create(suspended, {}, req())).rejects.toMatchObject({ status: 403 });
  });
});
