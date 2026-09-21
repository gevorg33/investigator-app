import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { personalContext, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import * as schema from '../../database/schema';
import { auditLogs } from '../../database/schema';
import { runInContext, type ExecutionContext } from '../context/execution-context';
import { AuditService } from './audit.service';

/**
 * Which workspace an audit entry belongs to, and why no caller decides that (T-080).
 *
 * The three columns are filled by DEFAULT, from the same transaction-local settings the policies
 * read. `AuditEvent` has no field for a workspace, a membership or a session — so there is
 * nothing to pass, nothing to forge, and nothing to forget. An entry written by any path at all
 * records where it happened.
 */
describe('an audit entry belongs to the workspace it happened in', () => {
  let app: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let audit: AuditService;
  let workspace: ExecutionContext;

  const action = () => `t080.probe.${randomUUID()}`;

  /** Read as the owner: what the application may see is `rls.spec.ts`'s subject, not this one. */
  const written = async (name: string) =>
    (await ownerDb.select().from(auditLogs).where(eq(auditLogs.action, name)))[0];

  beforeAll(async () => {
    app = testPool({ max: 2 });
    ownerSql = testPool({ max: 2, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    audit = new AuditService(scopedDb(app));
    workspace = await personalContext(ownerSql, (await member(ownerSql)).actor.userId);
  });

  afterAll(async () => {
    await app.end();
    await ownerSql.end();
  });

  it('records the workspace, membership and session of the request that wrote it', async () => {
    const name = action();
    await runInContext(workspace, () =>
      audit.record({ action: name, resourceType: 'probe', actorId: workspace.userId }),
    );
    expect(await written(name)).toMatchObject({
      tenantId: workspace.tenantId,
      membershipId: workspace.membershipId,
      sessionId: workspace.sessionId,
      actorId: workspace.userId,
    });
  });

  it('records no workspace for something that happened outside one', async () => {
    // Signing in, redeeming a token, a refused workspace: NULL here is the truth, not a gap.
    const name = action();
    await audit.record({ action: name, resourceType: 'probe' });
    expect(await written(name)).toMatchObject({
      tenantId: null,
      membershipId: null,
      sessionId: null,
    });
  });


  it('gives a caller no way to name a workspace, a membership or a session', () => {
    // Read from the source, not from a list kept in step by hand: the event type is where the
    // guarantee lives, and a field added there would show up here.
    const source = readFileSync(join(__dirname, 'audit.service.ts'), 'utf8');
    const event = source.slice(
      source.indexOf('export interface AuditEvent'),
      source.indexOf('}', source.indexOf('export interface AuditEvent')),
    );
    expect(event).not.toMatch(/tenantId|membershipId|sessionId/);
  });
  it('refuses an entry written into another workspace, whatever wrote it', async () => {
    // The policy, not the service: a raw insert naming another workspace is refused outright.
    const other = await personalContext(ownerSql, (await member(ownerSql)).actor.userId);
    const scoped = scopedDb(app);
    await expect(
      runInContext(workspace, async () => {
        await scoped
          .insert(auditLogs)
          .values({ action: action(), resourceType: 'probe', tenantId: other.tenantId });
      }),
      // Drizzle wraps the driver's error; the database's own words are on `cause`.
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });

  it('keeps one workspace’s entries out of another’s reach', async () => {
    const name = action();
    await runInContext(workspace, () => audit.record({ action: name, resourceType: 'probe' }));
    const other = await personalContext(ownerSql, (await member(ownerSql)).actor.userId);
    const scoped = scopedDb(app);

    // Awaited inside the context: a Drizzle query is lazy, and runs in whatever awaits it.
    const read = (context: ExecutionContext) =>
      runInContext(context, async () => {
        const rows = await scoped.select().from(auditLogs).where(eq(auditLogs.action, name));
        return rows;
      });
    const mine = await read(workspace);
    const theirs = await read(other);
    expect(mine).toHaveLength(1);
    expect(theirs).toEqual([]);
  });
});
