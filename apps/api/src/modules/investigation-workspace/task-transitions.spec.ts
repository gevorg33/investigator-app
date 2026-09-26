import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignment, investigationTask } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import * as schema from '../../database/schema';
import { SOURCES_WRITABLE } from '../investigation-sources/investigation-sources.service';
import { WORKSPACE_WRITABLE } from './assignment-access';
import { TASK_STATUSES, TASK_TRANSITIONS, canMove, type TaskStatus } from './task-transitions';

const pairs = TASK_STATUSES.flatMap((from) =>
  TASK_STATUSES.filter((to) => to !== from).map((to) => [from, to] as [TaskStatus, TaskStatus]),
);

describe('the task transition map (T-032)', () => {
  it('covers every status, so a new one cannot be added without deciding its moves', () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('never moves a task to where it already is', () => {
    for (const s of TASK_STATUSES) expect(canMove(s, s), s).toBe(false);
  });

  it('reopens a closed task to TODO and nowhere else — a cancelled task is not suddenly done', () => {
    expect(TASK_TRANSITIONS.DONE).toEqual(['TODO']);
    expect(TASK_TRANSITIONS.CANCELLED).toEqual(['TODO']);
  });

  it('lets everything open be started, finished or dropped', () => {
    for (const to of ['DONE', 'CANCELLED'] as const) {
      expect(canMove('TODO', to)).toBe(true);
      expect(canMove('IN_PROGRESS', to)).toBe(true);
    }
    expect(canMove('TODO', 'IN_PROGRESS')).toBe(true);
    expect(canMove('IN_PROGRESS', 'TODO')).toBe(true);
  });

  it('writes notes and tasks while the work is live, as the owner decided for sources', () => {
    expect([...WORKSPACE_WRITABLE].sort()).toEqual([...SOURCES_WRITABLE].sort());
  });

  /**
   * The same edges, held by `keep_investigation_task_record()`. Every ordered pair of distinct
   * statuses is tried against the database, as the owner — the role that bypasses row-level
   * security, so only the trigger can refuse — and must agree with the map.
   */
  describe('in the database', () => {
    let owner: postgres.Sql;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let assignmentId: string;
    let creator: string;

    beforeAll(async () => {
      owner = testPool({ role: 'owner', max: 2 });
      db = drizzle(owner, { schema });
      const mission = await quotableMission(db);
      const investigator = await eligibleInvestigator(db);
      const quote = await submittedQuote(db, {
        missionId: mission.missionId,
        investigatorProfileId: investigator.profileId,
      });
      const row = await assignment(db, {
        quoteId: quote.id,
        customerId: mission.customerId,
        status: 'IN_PROGRESS',
      });
      assignmentId = row.id;
      creator = investigator.userId;
    });

    afterAll(async () => {
      await owner.end();
    });

    it.each(pairs)('%s -> %s agrees with the map', async (from, to) => {
      const task = await investigationTask(db, { assignmentId, createdBy: creator });
      // Placed at `from` without a move: an insert is not a transition.
      await owner`UPDATE investigation_tasks SET status = 'TODO' WHERE id = ${task.id}`;
      if (from !== 'TODO') {
        // Every status is one legal step from TODO, so the fixture reaches it honestly.
        await owner`UPDATE investigation_tasks SET status = ${from} WHERE id = ${task.id}`;
      }
      const moved = owner`UPDATE investigation_tasks SET status = ${to} WHERE id = ${task.id}`;
      if (canMove(from, to)) await expect(moved).resolves.toBeDefined();
      else await expect(moved).rejects.toThrow(`a task cannot move from ${from} to ${to}`);
    });
  });
});
