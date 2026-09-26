import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignment } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import { asRequests, inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { assignments, auditLogs, investigationTasks } from '../../database/schema';
import { WORKSPACE_WRITABLE } from './assignment-access';
import { TasksService } from './tasks.service';

type Status = (typeof schema.assignmentStatus.enumValues)[number];

describe('investigation tasks (T-032)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: TasksService;
  const req = () => ({ ip: '198.51.100.41', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(new TasksService(db, new AuthzService(audit), audit), owner);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const work = async (status: Status = 'IN_PROGRESS') => {
    const mission = await quotableMission(ownerDb);
    const investigator = await eligibleInvestigator(ownerDb);
    const quote = await submittedQuote(ownerDb, {
      missionId: mission.missionId,
      investigatorProfileId: investigator.profileId,
    });
    const row = await assignment(ownerDb, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status,
    });
    return { customer: mission.actor, investigator: investigator.actor, id: row.id };
  };

  const moveTo = (id: string, status: Status) =>
    ownerDb
      .update(assignments)
      .set({ status, acceptedAt: status === 'PENDING_ACCEPTANCE' ? null : new Date() })
      .where(eq(assignments.id, id));

  const add = (actor: Actor, id: string, over: Record<string, unknown> = {}) =>
    service.create(actor, id, { title: 'Request the certified extract', ...over }, req());

  const auditOf = (taskId: string, action: string) =>
    ownerDb
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, taskId), eq(auditLogs.action, action)));

  describe('planning', () => {
    it('adds a task as private and still to do, by the investigator who added it', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id, { dueOn: '2026-10-02' });
      expect([task.status, task.visibility, task.createdBy, task.dueOn]).toEqual([
        'TODO',
        'PRIVATE',
        investigator.userId,
        '2026-10-02',
      ]);
    });

    it('puts each new task last, and lists the plan in its order', async () => {
      const { investigator, id } = await work();
      const first = await add(investigator, id, { title: 'First' });
      const second = await add(investigator, id, { title: 'Second' });
      const early = await add(investigator, id, { title: 'Before both', position: 0 });
      expect([first.position, second.position]).toEqual([0, 1]);
      // A tie at 0 falls back to when each was added.
      expect((await service.list(investigator, id, req())).map((t) => t.title)).toEqual([
        'First',
        'Before both',
        'Second',
      ]);
      await service.update(investigator, id, early.id, { position: 5 }, req());
      expect((await service.list(investigator, id, req())).map((t) => t.title)).toEqual([
        'First',
        'Second',
        'Before both',
      ]);
    });

    it('audits that a task was added and how visible it is, never its title', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id, {
        title: 'Interview the neighbour at 12 Example St',
      });
      const [entry] = await auditOf(task.id, 'investigation_task.created');
      expect(entry?.reason).toBe('PRIVATE');
      expect(JSON.stringify(entry)).not.toContain('neighbour');
    });

    it('refuses a title of only spaces as a field error', async () => {
      const { investigator, id } = await work();
      await expect(add(investigator, id, { title: '  ' })).rejects.toMatchObject({
        status: 422,
        details: [expect.objectContaining({ field: 'title', code: 'REQUIRED' })],
      });
      const task = await add(investigator, id);
      await expect(
        service.update(investigator, id, task.id, { title: ' ' }, req()),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('editing and sharing', () => {
    it('edits a task’s own fields and records which moved, not what they now say', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id, { description: 'Ask for the 2024 filing' });
      const edited = await service.update(
        investigator,
        id,
        task.id,
        { title: 'Request both extracts', dueOn: '2026-10-09' },
        req(),
      );
      expect([edited.title, edited.dueOn]).toEqual(['Request both extracts', '2026-10-09']);
      const [entry] = await auditOf(task.id, 'investigation_task.updated');
      expect(entry?.reason).toBe('title, dueOn');
    });

    it('clears a description and a due date with null', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id, { description: 'Detail', dueOn: '2026-10-02' });
      const cleared = await service.update(
        investigator,
        id,
        task.id,
        { description: null, dueOn: null },
        req(),
      );
      expect([cleared.description, cleared.dueOn]).toEqual([null, null]);
    });

    it('records who shared a task, as an action of its own, and the customer then sees it', async () => {
      const { customer, investigator, id } = await work();
      const task = await add(investigator, id);
      expect(await service.list(customer, id, req())).toEqual([]);
      await service.update(investigator, id, task.id, { visibility: 'SHARED' }, req());

      const [entry] = await auditOf(task.id, 'investigation_task.visibility_changed');
      expect([entry?.reason, entry?.actorId]).toEqual(['PRIVATE -> SHARED', investigator.userId]);
      expect(await auditOf(task.id, 'investigation_task.updated')).toEqual([]);
      expect((await service.list(customer, id, req())).map((t) => t.id)).toEqual([task.id]);
    });

    it('records nothing when nothing changed', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id);
      await service.update(investigator, id, task.id, { title: task.title, position: 0 }, req());
      expect(await auditOf(task.id, 'investigation_task.updated')).toEqual([]);
    });
  });

  describe('moving through the plan', () => {
    it('starts, finishes and reopens a task, auditing each move', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id);
      await service.transition(investigator, id, task.id, { to: 'IN_PROGRESS' }, req());
      await service.transition(investigator, id, task.id, { to: 'DONE' }, req());
      const reopened = await service.transition(investigator, id, task.id, { to: 'TODO' }, req());
      expect(reopened.status).toBe('TODO');
      const moves = await auditOf(task.id, 'investigation_task.moved');
      expect(moves.map((m) => m.reason).sort()).toEqual(
        ['DONE -> TODO', 'IN_PROGRESS -> DONE', 'TODO -> IN_PROGRESS'].sort(),
      );
    });

    it('refuses a move that is not an edge — 403, audited, and nothing moved', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id);
      await service.transition(investigator, id, task.id, { to: 'CANCELLED' }, req());
      await expect(
        service.transition(investigator, id, task.id, { to: 'DONE' }, req()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.transition(investigator, id, task.id, { to: 'CANCELLED' }, req()),
      ).rejects.toMatchObject({ status: 403 });
      const [row] = await ownerDb
        .select({ status: investigationTasks.status })
        .from(investigationTasks)
        .where(eq(investigationTasks.id, task.id));
      expect(row?.status).toBe('CANCELLED');
      const refused = await ownerDb
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceId, task.id),
            eq(auditLogs.action, 'authz.denied.investigation_task.transition'),
          ),
        );
      expect(refused).toHaveLength(2);
    });

    it('deletes a task out of both views, finally, and audits it once', async () => {
      const { customer, investigator, id } = await work();
      const task = await add(investigator, id, { visibility: 'SHARED' });
      await service.remove(investigator, id, task.id, req());
      expect(await service.list(investigator, id, req())).toEqual([]);
      expect(await service.list(customer, id, req())).toEqual([]);
      await expect(
        service.transition(investigator, id, task.id, { to: 'DONE' }, req()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.remove(investigator, id, task.id, req())).rejects.toMatchObject({
        status: 404,
      });
      expect(await auditOf(task.id, 'investigation_task.deleted')).toHaveLength(1);
    });
  });

  describe('while the work is live, and only then', () => {
    it.each([...WORKSPACE_WRITABLE])('plans while %s', async (status) => {
      const { investigator, id } = await work(status);
      await expect(add(investigator, id)).resolves.toMatchObject({ assignmentId: id });
    });

    it.each(['PENDING_ACCEPTANCE', 'COMPLETED', 'CANCELLED', 'SUSPENDED'] as const)(
      'refuses every write while %s, and still lets both sides read',
      async (status) => {
        const { customer, investigator, id } = await work('IN_PROGRESS');
        const task = await add(investigator, id, { visibility: 'SHARED' });
        await moveTo(id, status);

        await expect(add(investigator, id)).rejects.toMatchObject({ status: 403 });
        await expect(
          service.update(investigator, id, task.id, { title: 'Too late' }, req()),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          service.transition(investigator, id, task.id, { to: 'DONE' }, req()),
        ).rejects.toMatchObject({ status: 403 });
        await expect(service.remove(investigator, id, task.id, req())).rejects.toMatchObject({
          status: 403,
        });
        expect(await service.list(investigator, id, req())).toHaveLength(1);
        expect(await service.list(customer, id, req())).toHaveLength(1);
      },
    );
  });

  describe('the database holds the lines itself', () => {
    const asWorkspaceOf = <T>(
      userId: string,
      fn: (db: ReturnType<typeof scopedDb>) => Promise<T>,
    ) => inWorkspaceOf(owner, userId, async () => await fn(scopedDb(sql)));

    it('lets the customer’s workspace read shared, undeleted tasks and nothing else', async () => {
      const { customer, investigator, id } = await work();
      await add(investigator, id, { title: 'Private' });
      const shared = await add(investigator, id, { visibility: 'SHARED' });
      const deleted = await add(investigator, id, { visibility: 'SHARED' });
      await service.remove(investigator, id, deleted.id, req());

      const seen = await asWorkspaceOf(customer.userId, (db) =>
        db.select({ id: investigationTasks.id }).from(investigationTasks),
      );
      expect(seen.map((t) => t.id)).toEqual([shared.id]);
    });

    it('keeps a private task from anyone else in its creator’s workspace', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id);
      const [row] = await owner<{ supplier: string }[]>`
        SELECT supplier_tenant_id AS supplier FROM investigation_tasks WHERE id = ${task.id}`;
      const colleague = await person(ownerDb, { roles: ['INVESTIGATOR'] });
      const seen = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${row!.supplier}, true),
                        set_config('app.user_id', ${colleague.userId}, true)`;
        return tx`SELECT id FROM investigation_tasks WHERE assignment_id = ${id}`;
      });
      expect(seen).toHaveLength(0);
    });

    it('never lets the application delete one', async () => {
      const { investigator, id } = await work();
      const task = await add(investigator, id);
      await expect(
        asWorkspaceOf(investigator.userId, (db) =>
          db.delete(investigationTasks).where(eq(investigationTasks.id, task.id)),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
      });
    });

    it('keeps a task with its creator, and a deletion final', async () => {
      const a = await work();
      const b = await work();
      const task = await add(a.investigator, a.id);
      await expect(
        owner`UPDATE investigation_tasks SET created_by = ${b.investigator.userId} WHERE id = ${task.id}`,
      ).rejects.toThrow(/stays with its assignment and the person who created it/);
      await service.remove(a.investigator, a.id, task.id, req());
      await expect(
        owner`UPDATE investigation_tasks SET deleted_at = NULL WHERE id = ${task.id}`,
      ).rejects.toThrow(/stays deleted/);
    });

    it('does not go with its assignment: the assignment cannot be deleted from under it', async () => {
      const { investigator, id } = await work();
      await add(investigator, id);
      await expect(owner`DELETE FROM assignments WHERE id = ${id}`).rejects.toThrow(
        /investigation_tasks/,
      );
    });

    it('refuses a negative place in the plan, whoever writes it', async () => {
      const { investigator, id } = await work();
      await expect(
        owner`INSERT INTO investigation_tasks (assignment_id, created_by, title, position)
              VALUES (${id}, ${investigator.userId}, 'x', -1)`,
      ).rejects.toThrow(/investigation_tasks_position_non_negative/);
    });
  });
});
