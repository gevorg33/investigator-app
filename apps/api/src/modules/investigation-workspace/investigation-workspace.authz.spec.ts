import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import { assignment } from '../../../test/assignment-fixtures';
import { expectAuthorized } from '../../../test/authz-cases';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { assignments } from '../../database/schema';
import { NotesService } from './notes.service';
import { TasksService } from './tasks.service';

/**
 * Author, the other participant, a non-participant and staff — for every read and write of notes
 * and tasks (`authorization`, T-032).
 *
 * The case that matters most here is the second participant: the customer is a party to the
 * assignment and still never reaches a private note or task, by any route.
 */
describe('who may touch an assignment’s notes and tasks', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let notes: NotesService;
  let tasks: TasksService;
  const req = () => ({ ip: '198.51.100.42', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    notes = asRequests(new NotesService(db, authz, audit), owner);
    tasks = asRequests(new TasksService(db, authz, audit), owner);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const work = async () => {
    const mission = await quotableMission(ownerDb);
    const investigator = await eligibleInvestigator(ownerDb);
    const quote = await submittedQuote(ownerDb, {
      missionId: mission.missionId,
      investigatorProfileId: investigator.profileId,
    });
    const row = await assignment(ownerDb, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status: 'IN_PROGRESS',
    });
    return {
      customer: mission.actor,
      investigator: investigator.actor,
      stranger: (await eligibleInvestigator(ownerDb)).actor,
      staff: await person(ownerDb, { roles: ['STAFF'], staffScopes: ['DISPUTES'] }),
      id: row.id,
      complete: async () => {
        await ownerDb
          .update(assignments)
          .set({ status: 'COMPLETED' })
          .where(eq(assignments.id, row.id));
      },
    };
  };

  const cases = (w: Awaited<ReturnType<typeof work>>) => ({
    owner: w.investigator,
    otherOfSameRole: w.stranger,
    // The other participant: a party to the assignment, and not an author of anything in it.
    wrongRole: w.customer,
    suspended: testActor({ ...w.investigator, status: 'SUSPENDED' }),
    wrongState: { actor: w.investigator, setup: w.complete },
    // No staff scope writes an investigator's working notes; dispute review is T-118's, through
    // PlatformContext.
    staffOutsideScope: w.staff,
  });

  describe('notes', () => {
    it('lets only the author write one', async () => {
      const w = await work();
      await expectAuthorized(
        (actor) => notes.create(actor, w.id, { body: 'A line of inquiry' }, req()),
        cases(w),
      );
    });

    it('lets only the author edit or share one', async () => {
      const w = await work();
      const note = await notes.create(w.investigator, w.id, { body: 'x' }, req());
      let n = 0;
      await expectAuthorized(
        (actor) => notes.update(actor, w.id, note.id, { body: `Edit ${++n}` }, req()),
        cases(w),
      );
    });

    it('lets only the author delete one', async () => {
      const w = await work();
      const note = await notes.create(w.investigator, w.id, { body: 'x' }, req());
      const spare = await notes.create(w.investigator, w.id, { body: 'y' }, req());
      // The owner's attempt deletes `note`; every other case aims at `spare`, still there.
      await expectAuthorized(
        (actor) => notes.remove(actor, w.id, actor === w.investigator ? note.id : spare.id, req()),
        cases(w),
      );
    });

    it('never shows the other participant a private note, by any route', async () => {
      const { customer, investigator, id } = await work();
      const note = await notes.create(investigator, id, { body: 'Dismissed hypothesis' }, req());
      expect(await notes.list(customer, id, req())).toEqual([]);
      // A customer who also holds the investigator role is still not this assignment's.
      const both: Actor = testActor({ ...customer, roles: ['CUSTOMER', 'INVESTIGATOR'] });
      await expect(
        notes.update(both, id, note.id, { visibility: 'SHARED' }, req()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(notes.remove(both, id, note.id, req())).rejects.toMatchObject({ status: 404 });
    });

    it('shows notes to the two parties only — a stranger and staff get 404', async () => {
      const w = await work();
      const otherCustomer = (await quotableMission(ownerDb)).actor;
      await expect(notes.list(w.investigator, w.id, req())).resolves.toEqual([]);
      await expect(notes.list(w.customer, w.id, req())).resolves.toEqual([]);
      for (const outsider of [w.stranger, otherCustomer, w.staff]) {
        await expect(notes.list(outsider, w.id, req())).rejects.toMatchObject({ status: 404 });
      }
      await expect(notes.list(w.investigator, randomUUID(), req())).rejects.toMatchObject({
        status: 404,
      });
    });

    it('refuses a suspended account the read as well', async () => {
      const { investigator, id } = await work();
      await expect(
        notes.list(testActor({ ...investigator, status: 'SUSPENDED' }), id, req()),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('tasks', () => {
    it('lets only the creator add one', async () => {
      const w = await work();
      await expectAuthorized(
        (actor) => tasks.create(actor, w.id, { title: 'Request the extract' }, req()),
        cases(w),
      );
    });

    it('lets only the creator edit or share one', async () => {
      const w = await work();
      const task = await tasks.create(w.investigator, w.id, { title: 'x' }, req());
      let n = 0;
      await expectAuthorized(
        (actor) => tasks.update(actor, w.id, task.id, { title: `Edit ${++n}` }, req()),
        cases(w),
      );
    });

    it('lets only the creator move one', async () => {
      const w = await work();
      const task = await tasks.create(w.investigator, w.id, { title: 'x' }, req());
      await expectAuthorized(
        (actor) => tasks.transition(actor, w.id, task.id, { to: 'IN_PROGRESS' }, req()),
        {
          ...cases(w),
          // Moved once by the owner, so the state case asks for an edge it has left.
          wrongState: { actor: w.investigator, setup: async () => {} },
        },
      );
    });

    it('lets only the creator delete one', async () => {
      const w = await work();
      const task = await tasks.create(w.investigator, w.id, { title: 'x' }, req());
      const spare = await tasks.create(w.investigator, w.id, { title: 'y' }, req());
      await expectAuthorized(
        (actor) => tasks.remove(actor, w.id, actor === w.investigator ? task.id : spare.id, req()),
        cases(w),
      );
    });

    it('never shows the other participant a private task', async () => {
      const { customer, investigator, id } = await work();
      await tasks.create(investigator, id, { title: 'Check the second trading name' }, req());
      expect(await tasks.list(customer, id, req())).toEqual([]);
    });

    it('shows tasks to the two parties only — a stranger and staff get 404', async () => {
      const w = await work();
      await expect(tasks.list(w.customer, w.id, req())).resolves.toEqual([]);
      for (const outsider of [w.stranger, w.staff]) {
        await expect(tasks.list(outsider, w.id, req())).rejects.toMatchObject({ status: 404 });
      }
    });
  });
});
