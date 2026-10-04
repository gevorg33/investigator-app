import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import type { TestDb } from '../../../test/mission-fixtures';
import { personalContext, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import { auditLogs, userBlocks } from '../../database/schema';
import { RetentionGuard } from './retention-guard';

/**
 * The guard itself, on a table with two resources a row belongs to: a block belongs to the person
 * who made it and to the workspace it was made in. No retention rule removes blocks — the table is
 * here for its shape, and the sweep is confined to the rows each test made.
 */
describe('the retention guard (T-035)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: TestDb;
  let guard: RetentionGuard;
  let db: ReturnType<typeof scopedDb>;
  let platform: PlatformContext;
  const req = (correlationId = randomUUID()) => ({ ip: '198.51.100.36', correlationId });

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    db = scopedDb(sql);
    const audit = new AuditService(db);
    platform = new PlatformContext(audit);
    guard = new RetentionGuard(audit);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  /** A block made by a new person in their Personal workspace. */
  const block = async () => {
    const blocker = (await person(ownerDb)).userId;
    const blocked = (await person(ownerDb)).userId;
    const { tenantId } = await personalContext(owner, blocker);
    const [row] = await ownerDb
      .insert(userBlocks)
      .values({ blockerId: blocker, blockedId: blocked, tenantId, source: 'profile' })
      .returning();
    return row!;
  };
  const hold = async (type: 'USER' | 'TENANT', resourceId: string) =>
    (
      await owner<{ id: string }[]>`
        INSERT INTO legal_holds (resource_type, resource_id, reason, placed_by)
        VALUES (${type}, ${resourceId}, 'Preservation request in a test.', ${randomUUID()})
        RETURNING id`
    )[0]!.id;
  const of = (ids: string[]) => ({
    rule: 'retention.oauth_attempts' as const,
    table: userBlocks,
    due: inArray(userBlocks.id, ids),
    heldBy: [
      { type: 'USER' as const, column: userBlocks.blockerId },
      { type: 'TENANT' as const, column: userBlocks.tenantId },
    ] as const,
  });
  /** As the job runner sweeps (T-204): in the system context, in the job's transaction. */
  const sweep = (ids: string[], r = req()) =>
    platform.asSystem('jobs.run_system', r, () =>
      db.transaction((tx) => guard.sweep(tx, of(ids), r)),
    );
  const remaining = async (ids: string[]) =>
    (
      await ownerDb
        .select({ id: userBlocks.id })
        .from(userBlocks)
        .where(inArray(userBlocks.id, ids))
    )
      .map((r) => r.id)
      .sort();
  const trail = (correlationId: string) =>
    ownerDb
      .select({
        action: auditLogs.action,
        actorRole: auditLogs.actorRole,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        reason: auditLogs.reason,
      })
      .from(auditLogs)
      .where(eq(auditLogs.correlationId, correlationId));

  it('deletes what is due and unheld, keeps what any of its resources holds, and reports each hold', async () => {
    const free = await block();
    const byPerson = await block();
    const byWorkspace = await block();
    const both = await block();
    const personHold = await hold('USER', byPerson.blockerId);
    const workspaceHold = await hold('TENANT', byWorkspace.tenantId);
    await hold('USER', both.blockerId);
    await hold('TENANT', both.tenantId);
    const ids = [free.id, byPerson.id, byWorkspace.id, both.id];

    const r = req();
    expect(await sweep(ids, r)).toEqual({ deleted: 1, kept: 3 });
    expect(await remaining(ids)).toEqual([byPerson.id, byWorkspace.id, both.id].sort());

    const audited = await trail(r.correlationId);
    expect(audited).toEqual(
      expect.arrayContaining([
        {
          action: 'platform.access',
          actorRole: 'SYSTEM',
          resourceType: 'workspace',
          resourceId: 'jobs.run_system',
          reason: null,
        },
        {
          action: 'retention.kept',
          actorRole: 'SYSTEM',
          resourceType: 'legal_hold',
          resourceId: personHold,
          reason: 'retention.oauth_attempts: 1 due for deletion, kept under this hold',
        },
        {
          action: 'retention.kept',
          actorRole: 'SYSTEM',
          resourceType: 'legal_hold',
          resourceId: workspaceHold,
          reason: 'retention.oauth_attempts: 1 due for deletion, kept under this hold',
        },
        {
          action: 'retention.deleted',
          actorRole: 'SYSTEM',
          resourceType: 'retention_rule',
          resourceId: 'retention.oauth_attempts',
          reason: '1 deleted',
        },
      ]),
    );
    // A row under two holds is reported under each of them.
    expect(audited.filter((a) => a.action === 'retention.kept')).toHaveLength(4);
    expect(audited).toHaveLength(6);
  });

  it('records no deletion when every row due is held', async () => {
    const held = await block();
    await hold('USER', held.blockerId);
    const r = req();

    expect(await sweep([held.id], r)).toEqual({ deleted: 0, kept: 1 });
    expect(await remaining([held.id])).toEqual([held.id]);
    expect((await trail(r.correlationId)).map((a) => a.action).sort()).toEqual([
      'platform.access',
      'retention.kept',
    ]);
  });

  it('lets a released hold keep nothing', async () => {
    const row = await block();
    const id = await hold('USER', row.blockerId);
    await owner`
      UPDATE legal_holds SET released_at = now(), released_by = ${randomUUID()},
             release_reason = 'Preservation period ended.' WHERE id = ${id}`;

    expect(await sweep([row.id])).toEqual({ deleted: 1, kept: 0 });
    expect(await remaining([row.id])).toEqual([]);
  });

  it('refuses to sweep outside platform access, where it would see no hold, and deletes nothing', async () => {
    const held = await block();
    await hold('USER', held.blockerId);
    await expect(db.transaction((tx) => guard.sweep(tx, of([held.id]), req()))).rejects.toThrow(
      /retention outside platform access/,
    );
    expect(await remaining([held.id])).toEqual([held.id]);
  });

  it('touches nothing that is not due', async () => {
    const due = await block();
    const notDue = await block();

    await sweep([due.id]);
    expect(await remaining([due.id, notDue.id])).toEqual([notDue.id]);
  });
});
