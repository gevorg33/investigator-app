import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { runInContext, type ExecutionContext } from '../../common/context/execution-context';
import * as schema from '../../database/schema';
import { aiMessages, aiSessions, auditLogs } from '../../database/schema';
import { IDLE_AFTER_MS, statusOf } from './ai-sessions.policy';
import { AiSessionsService, SESSION_CONTENT } from './ai-sessions.service';

describe('assistant sessions (ADR-0006, T-045)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let raw: AiSessionsService;
  let service: AiSessionsService;
  let me: Actor;
  const req = () => ({ ip: '198.51.100.45', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    me = (await member(owner)).actor;
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

  const start = (title?: string) => service.create(me, { title }, req());
  const say = (sessionId: string, content: string) =>
    service.append(me, sessionId, { role: 'USER', content }, req());
  const auditOf = (sessionId: string, action: string) =>
    ownerDb
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, sessionId), eq(auditLogs.action, action)));

  describe('the lifecycle, read from facts', () => {
    const at = new Date('2026-09-23T12:00:00.000Z');
    const minutesAgo = (m: number) => new Date(at.getTime() - m * 60_000);

    it('is ACTIVE until it has been quiet for the idle interval, then IDLE', () => {
      const quiet = (m: number) =>
        statusOf({ deletedAt: null, archivedAt: null, lastActivityAt: minutesAgo(m) }, at);
      expect(quiet(29)).toBe('ACTIVE');
      expect(quiet(IDLE_AFTER_MS / 60_000)).toBe('IDLE');
    });

    it('puts DELETED above ARCHIVED, and ARCHIVED above activity', () => {
      expect(statusOf({ deletedAt: at, archivedAt: at, lastActivityAt: at }, at)).toBe('DELETED');
      expect(statusOf({ deletedAt: null, archivedAt: at, lastActivityAt: at }, at)).toBe(
        'ARCHIVED',
      );
    });
  });

  describe('create, open, rename, archive, resume', () => {
    it('starts untitled unless given a title, and says so', async () => {
      const untitled = await start();
      expect([untitled.title, untitled.status]).toEqual([null, 'ACTIVE']);
      expect((await start('  Planning a mission  ')).title).toBe('Planning a mission');
      expect(await auditOf(untitled.id, 'ai_session.created')).toHaveLength(1);
    });

    it('opens a session, and 404s one that does not exist', async () => {
      const session = await start('Background check questions');
      expect((await service.open(me, session.id, req())).title).toBe('Background check questions');
      await expect(service.open(me, randomUUID(), req())).rejects.toMatchObject({ status: 404 });
    });

    it('renames, and records the rename without the words — a title is the user’s own', async () => {
      const session = await start();
      const renamed = await service.rename(me, session.id, ' Due diligence on Example LLC ', req());
      expect(renamed.title).toBe('Due diligence on Example LLC');
      const [entry] = await auditOf(session.id, 'ai_session.renamed');
      expect(JSON.stringify(entry)).not.toContain('Example LLC');
    });

    it('archives once, and resumes back into the current list', async () => {
      const session = await start();
      expect((await service.archive(me, session.id, req())).status).toBe('ARCHIVED');
      await service.archive(me, session.id, req());
      expect(await auditOf(session.id, 'ai_session.archived')).toHaveLength(1);

      const archived = await service.list(me, { archived: true }, req());
      expect(archived.items.map((s) => s.id)).toContain(session.id);
      expect((await service.resume(me, session.id, req())).status).toBe('ACTIVE');
      const current = await service.list(me, {}, req());
      expect(current.items.map((s) => s.id)).toContain(session.id);
    });
  });

  describe('listing', () => {
    it('pages most-recent first, and ends', async () => {
      const someone = (await member(owner)).actor;
      const mine = asRequests(raw, owner);
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push((await mine.create(someone, {}, req())).id);
        await new Promise((r) => setTimeout(r, 5));
      }
      const first = await mine.list(someone, { limit: 2 }, req());
      expect(first.items.map((s) => s.id)).toEqual([ids[2], ids[1]]);
      expect(first.pageInfo.hasNextPage).toBe(true);
      const second = await mine.list(
        someone,
        { limit: 2, cursor: first.pageInfo.nextCursor! },
        req(),
      );
      expect(second.items.map((s) => s.id)).toEqual([ids[0]]);
      expect(second.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
    });

    it('refuses a cursor from the other list, or one that is not a cursor', async () => {
      const someone = (await member(owner)).actor;
      const mine = asRequests(raw, owner);
      for (let i = 0; i < 2; i++) await mine.create(someone, {}, req());
      const page = await mine.list(someone, { limit: 1 }, req());
      await expect(
        mine.list(someone, { archived: true, cursor: page.pageInfo.nextCursor! }, req()),
      ).rejects.toMatchObject({ status: 422 });
      for (const cursor of [
        'not-a-cursor',
        Buffer.from('{"a":false,"t":"x","i":"y"}').toString('base64url'),
      ]) {
        await expect(mine.list(someone, { cursor }, req())).rejects.toMatchObject({ status: 422 });
      }
    });
  });

  describe('messages', () => {
    it('numbers them in order and pages through them', async () => {
      const session = await start();
      for (const words of ['one', 'two', 'three']) await say(session.id, words);
      const first = await service.messages(me, session.id, { limit: 2 }, req());
      expect(first.items.map((m) => [m.sequence, m.content])).toEqual([
        [1, 'one'],
        [2, 'two'],
      ]);
      const rest = await service.messages(
        me,
        session.id,
        { cursor: first.pageInfo.nextCursor! },
        req(),
      );
      expect(rest.items.map((m) => m.sequence)).toEqual([3]);
      expect(rest.pageInfo.hasNextPage).toBe(false);
      await expect(
        service.messages(me, session.id, { cursor: 'nonsense' }, req()),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('never gives two messages the same place, however they arrive', async () => {
      const session = await start();
      await Promise.all(Array.from({ length: 6 }, (_, i) => say(session.id, `m${i}`)));
      const page = await service.messages(me, session.id, {}, req());
      expect(page.items.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('stores a tool call and its result as structured events, not prose', async () => {
      const session = await start();
      await say(session.id, 'Who works in Yerevan?');
      await service.append(
        me,
        session.id,
        {
          role: 'ASSISTANT',
          kind: 'TOOL_CALL',
          event: { tool: 'searchInvestigators', arguments: { city: 'Yerevan' } },
        },
        req(),
      );
      await service.append(
        me,
        session.id,
        {
          role: 'TOOL',
          kind: 'TOOL_RESULT',
          event: { tool: 'searchInvestigators', resultId: 'res_1' },
        },
        req(),
      );
      const events = (await service.messages(me, session.id, {}, req())).items.slice(1);
      expect(events.map((e) => [e.kind, e.event])).toEqual([
        ['TOOL_CALL', { tool: 'searchInvestigators', arguments: { city: 'Yerevan' } }],
        ['TOOL_RESULT', { tool: 'searchInvestigators', resultId: 'res_1' }],
      ]);
    });

    it('brings an archived session back when a message arrives', async () => {
      const session = await start();
      await service.archive(me, session.id, req());
      await say(session.id, 'Picking this up again');
      expect((await service.open(me, session.id, req())).status).toBe('ACTIVE');
    });
  });

  describe('deleting', () => {
    it('erases every message now, and keeps a tombstone with no title', async () => {
      const session = await start('Something private');
      await say(session.id, 'A detail about a person who is not a user');
      await say(session.id, 'And another');

      await service.delete(me, session.id, req());

      const left = await ownerDb
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.sessionId, session.id));
      expect(left).toEqual([]);
      const [tombstone] = await ownerDb
        .select()
        .from(aiSessions)
        .where(eq(aiSessions.id, session.id));
      expect([tombstone?.title, tombstone?.deletedAt !== null, tombstone?.userId]).toEqual([
        null,
        true,
        me.userId,
      ]);
      const [entry] = await auditOf(session.id, 'ai_session.deleted');
      expect(entry?.reason).toBe('2 rows erased');
    });

    it('is gone from every path afterwards, including a second delete', async () => {
      const session = await start('Soon gone');
      await service.delete(me, session.id, req());
      await expect(service.open(me, session.id, req())).rejects.toMatchObject({ status: 404 });
      await expect(say(session.id, 'hello?')).rejects.toMatchObject({ status: 404 });
      await expect(service.delete(me, session.id, req())).rejects.toMatchObject({ status: 404 });
      expect((await service.list(me, {}, req())).items.map((s) => s.id)).not.toContain(session.id);
      expect((await service.search(me, 'Soon gone', req())).map((s) => s.id)).not.toContain(
        session.id,
      );
    });

    it('erases every table that holds a session’s content — a new one cannot be forgotten', async () => {
      // Summaries (T-046), memory (T-047) and embeddings will reference ai_sessions. Deletion
      // walks SESSION_CONTENT, so this fails until each new one is added there.
      const referencing = await owner<{ table: string }[]>`
        SELECT DISTINCT c.conrelid::regclass::text AS table
          FROM pg_constraint c
         WHERE c.contype = 'f' AND c.confrelid = 'ai_sessions'::regclass`;
      const erased = SESSION_CONTENT.map(
        ({ table }) =>
          (table as unknown as { [k: symbol]: string })[
            Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name')!
          ],
      );
      expect(referencing.map((r) => r.table).sort()).toEqual([...erased].sort());
    });
  });

  describe('search', () => {
    it('finds a conversation by its title or by what was said, best first', async () => {
      const someone = (await member(owner)).actor;
      const mine = asRequests(raw, owner);
      const titled = await mine.create(someone, { title: 'Counterparty screening' }, req());
      const said = await mine.create(someone, {}, req());
      await mine.append(someone, said.id, { role: 'USER', content: 'hello' }, req());
      await mine.append(
        someone,
        said.id,
        { role: 'USER', content: 'Is counterparty screening lawful here?' },
        req(),
      );

      const found = await mine.search(someone, 'counterparty screening', req());
      expect(found.map((s) => s.id).sort()).toEqual([titled.id, said.id].sort());
      expect(found.find((s) => s.id === said.id)?.firstMatchSequence).toBe(2);
      expect(found.find((s) => s.id === titled.id)?.firstMatchSequence).toBeNull();
    });

    it('searches Armenian and Russian as well as English', async () => {
      const someone = (await member(owner)).actor;
      const mine = asRequests(raw, owner);
      const hy = await mine.create(someone, { title: 'Երևանում աշխատող հետազոտող' }, req());
      const ru = await mine.create(someone, { title: 'Проверка контрагента' }, req());
      expect((await mine.search(someone, 'Երևանում', req())).map((s) => s.id)).toEqual([hy.id]);
      expect((await mine.search(someone, 'контрагента', req())).map((s) => s.id)).toEqual([ru.id]);
    });

    it('takes whatever a person types without a syntax error', async () => {
      for (const q of ['"unterminated', 'a & | ! b', "O'Brien (maybe)"]) {
        await expect(service.search(me, q, req())).resolves.toBeInstanceOf(Array);
      }
      expect(await service.search(me, 'zzqx-nothing-matches', req())).toEqual([]);
    });
  });

  describe('one workspace for life', () => {
    const agencyContext = async (userId: string, tenantId: string): Promise<ExecutionContext> => {
      const [m] = await owner<{ id: string }[]>`
        SELECT id FROM tenant_memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
      return {
        tenantId,
        tenantKind: 'AGENCY',
        userId,
        membershipId: m!.id,
        sessionId: randomUUID(),
        permissions: [],
      };
    };

    it('keeps a session in the workspace it began in — the same person elsewhere does not see it', async () => {
      const { actor } = await member(owner);
      const firm = await agency(owner, [{ userId: actor.userId }]);
      const personal = await asRequests(raw, owner).create(
        actor,
        { title: 'Personal matter' },
        req(),
      );

      const inFirm = await agencyContext(actor.userId, firm.tenantId);
      await expect(
        runInContext(inFirm, () => raw.open(actor, personal.id, req())),
      ).rejects.toMatchObject({
        status: 404,
      });
      const listed = await runInContext(inFirm, () => raw.list(actor, {}, req()));
      expect(listed.items).toEqual([]);
    });

    it('refuses to start one outside any workspace', async () => {
      await expect(raw.create(me, {}, req())).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('the database holds the record', () => {
    it('never rewrites a message', async () => {
      const session = await start();
      await say(session.id, 'As said');
      await expect(
        owner`UPDATE ai_messages SET content = 'As rewritten' WHERE session_id = ${session.id}`,
      ).rejects.toThrow(/never rewritten/);
    });

    it('keeps a deleted session empty, whoever tries', async () => {
      const session = await start();
      await service.delete(me, session.id, req());
      await expect(
        owner`INSERT INTO ai_messages (session_id, sequence, role, content) VALUES (${session.id}, 1, 'USER', 'x')`,
      ).rejects.toThrow(/takes no messages/);
    });

    it('refuses a tool call that is prose, or a text message with no words', async () => {
      const session = await start();
      await expect(
        owner`INSERT INTO ai_messages (session_id, sequence, role, kind, content)
              VALUES (${session.id}, 1, 'ASSISTANT', 'TOOL_CALL', 'I searched for investigators')`,
      ).rejects.toThrow(/ai_messages_shape/);
      await expect(
        owner`INSERT INTO ai_messages (session_id, sequence, role, kind) VALUES (${session.id}, 1, 'USER', 'TEXT')`,
      ).rejects.toThrow(/ai_messages_shape/);
      // An event with nothing in it: every lookup inside is NULL, and a CHECK passes on NULL
      // unless each one is coalesced to false. This row went through before it was.
      await expect(
        owner`INSERT INTO ai_messages (session_id, sequence, role, kind, event)
              VALUES (${session.id}, 1, 'TOOL', 'TOOL_RESULT', '{}'::jsonb)`,
      ).rejects.toThrow(/ai_messages_shape/);
    });

    it('keeps a tombstone blank — no title on a deleted session', async () => {
      const session = await start('Named');
      await expect(
        owner`UPDATE ai_sessions SET deleted_at = now() WHERE id = ${session.id}`,
      ).rejects.toThrow(/ai_sessions_deleted_is_blank/);
    });
  });
});
