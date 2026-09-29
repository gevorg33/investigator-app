import { randomUUID } from 'node:crypto';
import { eq, sql as raw } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPool } from '../../../test/db';
import { TEST_REDIS_URL, testQueuePrefix } from '../../../test/redis';
import { personalContext, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import type { Db, Tx } from '../../database/database.module';
import * as schema from '../../database/schema';
import { outboxEvents } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { AuthzService } from '../authz/authz.service';
import { currentContext, runInContext, type ExecutionContext } from '../context/execution-context';
import { PlatformContext } from '../context/platform-context';
import { WorkspaceResolver } from '../context/workspace.resolver';
import { DeadLetters } from './dead-letters';
import type { JobEnvelope, QueueName } from './job';
import { JobQueue, JobWorkers } from './job-queue';
import { JobRunner } from './job-runner';
import { deliveryOf, DISPATCH_BATCH, OutboxDispatcher, rest } from './outbox-dispatcher';
import {
  OUTBOX_DELIVER,
  OutboxDeliveryHandler,
  type EventSubscriber,
  type OutboxEvent,
} from './outbox-delivery.handler';

/**
 * The outbox and its dispatcher (T-082): an event is written as its producer and read only by the
 * dispatcher, in the system context, which hands it off as a job in the producer's workspace.
 */
describe('the outbox', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let db: Db;
  let platform: PlatformContext;

  beforeAll(() => {
    sql = testPool({ max: 4 });
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    db = scopedDb(sql);
    platform = new PlatformContext(new AuditService(db));
  });

  beforeEach(async () => {
    // One dispatcher at a time in these tests, over events these tests wrote.
    await ownerSql`UPDATE outbox_events SET published_at = now() WHERE published_at IS NULL`;
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  const producer = async () => personalContext(ownerSql, (await member(ownerSql)).actor.userId);

  /**
   * An event written the way a service writes one: in its transaction, in its context, and without
   * RETURNING — PostgreSQL checks a returned row against the read policy, and a producer may not
   * read the outbox (see the test below).
   */
  const produce = async (context: ExecutionContext | undefined, eventType = 'mission.probe') => {
    const id = randomUUID();
    const write = () =>
      db.transaction(async (tx) => {
        await tx.insert(outboxEvents).values({
          id,
          aggregateType: 'mission',
          aggregateId: randomUUID(),
          eventType,
          payload: { status: 'SUBMITTED' },
        });
      });
    await (context === undefined
      ? platform.asSystem('assignment.create_from_payment', {}, write)
      : runInContext(context, write));
    return id;
  };
  const stored = async (id: string) =>
    (await ownerDb.select().from(outboxEvents).where(eq(outboxEvents.id, id)))[0]!;

  describe('writing an event', () => {
    it('records who produced it from the context, never from the caller', async () => {
      const context = await producer();
      const id = await produce(context);
      expect(await stored(id)).toMatchObject({
        tenantId: context.tenantId,
        userId: context.userId,
        membershipId: context.membershipId,
        publishedAt: null,
      });
    });

    it('cannot even be read back by the statement that wrote it', async () => {
      const context = await producer();
      await expect(
        runInContext(context, () =>
          db
            .insert(outboxEvents)
            .values({
              aggregateType: 'mission',
              aggregateId: randomUUID(),
              eventType: 'e',
              payload: {},
            })
            .returning({ id: outboxEvents.id }),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it('cannot be written as someone else — not even another member of the same workspace', async () => {
      const [mine, theirs] = [await producer(), await producer()];
      for (const forged of [
        { tenantId: theirs.tenantId },
        { userId: theirs.userId },
        { membershipId: theirs.membershipId },
      ]) {
        await expect(
          runInContext(mine, () =>
            db.insert(outboxEvents).values({
              aggregateType: 'mission',
              aggregateId: randomUUID(),
              eventType: 'e',
              payload: {},
              ...forged,
            }),
          ),
        ).rejects.toMatchObject({ cause: { code: '42501' } });
      }
    });

    it('is read by nobody but the dispatcher — not even its producer', async () => {
      const context = await producer();
      const id = await produce(context);
      const seen = await runInContext(context, () =>
        db.select().from(outboxEvents).where(eq(outboxEvents.id, id)),
      );
      expect(seen).toEqual([]);
    });

    it('from the system carries no producer', async () => {
      const id = await produce(undefined);
      expect(await stored(id)).toMatchObject({ tenantId: null, userId: null, membershipId: null });
    });
  });

  describe('dispatching', () => {
    let handed: Array<{ queue: QueueName; envelope: JobEnvelope }>;
    let failEnqueue: boolean;
    const queue = {
      enqueue: async (q: QueueName, envelope: JobEnvelope) => {
        if (failEnqueue) throw new Error('redis is down');
        handed.push({ queue: q, envelope });
      },
    } as unknown as JobQueue;
    const dispatcher = () => new OutboxDispatcher(db, platform, queue);

    beforeEach(() => {
      handed = [];
      failEnqueue = false;
    });

    it('hands each event off as a delivery in its producer’s context, and marks it published', async () => {
      const context = await producer();
      const [ours, systems] = [await produce(context), await produce(undefined)];
      expect(await dispatcher().dispatchOnce()).toBe(2);
      expect(handed).toEqual([
        { queue: 'events', envelope: deliveryOf(await stored(ours)) },
        { queue: 'events', envelope: deliveryOf(await stored(systems)) },
      ]);
      expect(handed[0]!.envelope).toMatchObject({
        jobId: `outbox-${ours}`,
        key: ours,
        command: OUTBOX_DELIVER,
        tenantId: context.tenantId,
        userId: context.userId,
        membershipId: context.membershipId,
        payload: {
          eventId: ours,
          eventType: 'mission.probe',
          aggregateType: 'mission',
          data: { status: 'SUBMITTED' },
        },
      });
      expect(handed[1]!.envelope).toMatchObject({
        tenantId: null,
        userId: null,
        membershipId: null,
      });
      expect((await stored(ours)).publishedAt).toBeInstanceOf(Date);
      expect((await stored(ours)).attempts).toBe(1);
      expect(await dispatcher().dispatchOnce()).toBe(0);
    });

    it('leaves events unpublished when handing them off fails, for the next pass', async () => {
      const id = await produce(await producer());
      failEnqueue = true;
      await expect(dispatcher().dispatchOnce()).rejects.toThrow('redis is down');
      expect((await stored(id)).publishedAt).toBeNull();
      failEnqueue = false;
      expect(await dispatcher().dispatchOnce()).toBe(1);
    });

    it('runs until stopped, resting only when the outbox is short of a batch, audited once', async () => {
      await produce(await producer());
      const stop = new AbortController();
      const sleep = vi.fn(async () => {
        if (sleep.mock.calls.length >= 2) stop.abort();
      });
      const before = await ownerSql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = 'outbox.dispatch'`;
      await dispatcher().run(stop.signal, sleep);
      expect(handed).toHaveLength(1);
      expect(sleep).toHaveBeenCalledWith(1_000, stop.signal);
      const after = await ownerSql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = 'outbox.dispatch'`;
      expect(after[0]!.n - before[0]!.n).toBe(1);
    });

    it('does not rest while a full batch keeps coming', async () => {
      const context = await producer();
      for (let i = 0; i <= DISPATCH_BATCH; i++) await produce(context);
      const stop = new AbortController();
      const sleep = vi.fn(async () => stop.abort());
      await dispatcher().run(stop.signal, sleep);
      expect(handed).toHaveLength(DISPATCH_BATCH + 1);
      expect(sleep).toHaveBeenCalledTimes(1);
    });
  });

  describe('delivering, end to end through Redis', () => {
    const open: Array<{ close(): Promise<void> }> = [];
    afterEach(async () => {
      await Promise.all(open.splice(0).map((o) => o.close()));
    });

    it('runs each subscriber once, in the producer’s workspace, however often the event is handed off', async () => {
      const calls: Array<{ event: OutboxEvent; tenant: string | undefined; inDb: string | null }> =
        [];
      let delivered!: () => void;
      const arrived = new Promise<void>((resolve) => (delivered = resolve));
      const subscriber: EventSubscriber = {
        eventType: 'mission.submitted',
        handle: async (event, tx: Tx) => {
          const [row] = await tx.execute<{ t: string | null }>(
            raw`SELECT app_current_tenant() AS t`,
          );
          calls.push({ event, tenant: currentContext()?.tenantId, inDb: row!.t });
          delivered();
        },
      };
      const config = { redisUrl: TEST_REDIS_URL, prefix: testQueuePrefix() };
      const audit = new AuditService(db);
      const handler = new OutboxDeliveryHandler([
        subscriber,
        { eventType: 'other', handle: vi.fn() },
      ]);
      const runner = new JobRunner(
        db,
        new WorkspaceResolver(db, new AuthzService(audit)),
        platform,
        [handler],
      );
      const jobQueue = new JobQueue(config);
      const workers = new JobWorkers(config, runner, new DeadLetters(db, platform), [handler]);
      open.push(workers, jobQueue);

      const context = await producer();
      const id = await produce(context, 'mission.submitted');
      await new OutboxDispatcher(db, platform, jobQueue).dispatchOnce();
      await workers.start(() => undefined);
      await arrived;
      // Handed off again — a dispatcher that crashed before committing — the work is already done.
      expect(await runner.run(deliveryOf(await stored(id)))).toBe('duplicate');
      expect(calls).toEqual([
        {
          event: {
            eventId: id,
            eventType: 'mission.submitted',
            aggregateType: 'mission',
            aggregateId: (await stored(id)).aggregateId,
            data: { status: 'SUBMITTED' },
          },
          tenant: context.tenantId,
          inDb: context.tenantId,
        },
      ]);
    });
  });

  describe('the delivery handler', () => {
    const handler = new OutboxDeliveryHandler([]);
    it.each([
      ['nothing', undefined],
      [
        'an event id that is not one',
        { eventId: 'x', eventType: 'e', aggregateType: 'a', aggregateId: randomUUID(), data: {} },
      ],
      [
        'no data',
        { eventId: randomUUID(), eventType: 'e', aggregateType: 'a', aggregateId: randomUUID() },
      ],
      [
        'an aggregate id that is not one',
        { eventId: randomUUID(), eventType: 'e', aggregateType: 'a', aggregateId: 'm', data: {} },
      ],
      [
        'no event type',
        { eventId: randomUUID(), aggregateType: 'a', aggregateId: randomUUID(), data: {} },
      ],
      [
        'no aggregate type',
        { eventId: randomUUID(), eventType: 'e', aggregateId: randomUUID(), data: {} },
      ],
    ])('refuses %s', (_label, payload) => {
      expect(() => handler.parse(payload)).toThrow('not an outbox event');
    });
  });

  it('rests until its time is up, or it is stopped', async () => {
    const quick = new AbortController();
    const started = Date.now();
    await rest(5, quick.signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
    const stopped = new AbortController();
    const waiting = rest(60_000, stopped.signal);
    stopped.abort();
    await expect(waiting).resolves.toBeUndefined();
  });
});
