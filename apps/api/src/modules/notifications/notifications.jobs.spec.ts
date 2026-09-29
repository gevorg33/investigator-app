import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { seedGraph, type SeededGraph } from '../../../test/isolation/graph';
import { TEST_REDIS_URL, testQueuePrefix } from '../../../test/redis';
import { scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import { PlatformContext } from '../../common/context/platform-context';
import { WorkspaceResolver } from '../../common/context/workspace.resolver';
import { DeadLetters } from '../../common/jobs/dead-letters';
import {
  envelopeAs,
  PermanentJobError,
  systemEnvelope,
  type JobEnvelope,
  type QueueName,
} from '../../common/jobs/job';
import { JobQueue, JobWorkers } from '../../common/jobs/job-queue';
import { JobRunner } from '../../common/jobs/job-runner';
import { OutboxDispatcher } from '../../common/jobs/outbox-dispatcher';
import { OutboxDeliveryHandler, type OutboxEvent } from '../../common/jobs/outbox-delivery.handler';
import type { Mailer, MailMessage } from '../../common/mail/mailer';
import * as schema from '../../database/schema';
import { notifications } from '../../database/schema';
import {
  DELIVER,
  DeliverHandler,
  FAN_OUT,
  FanOutHandler,
  NotificationTrigger,
  SEND_EMAIL,
  SendEmailHandler,
  type Notice,
} from './notification-jobs';
import { readUnsubscribeToken } from './unsubscribe';

/**
 * Delivering notifications (T-036): an event is fanned out in the system context, each person gets
 * theirs in their own workspace — once per (event, recipient, channel) — and an email, in their
 * language, says what happened and never what it contained.
 */
describe('notification delivery', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let graph: SeededGraph;
  let runner: JobRunner;
  let queued: Array<{ queue: QueueName; envelope: JobEnvelope }>;
  let mailed: MailMessage[];
  const queue = {
    enqueue: async (q: QueueName, envelope: JobEnvelope) =>
      void queued.push({ queue: q, envelope }),
  } as unknown as JobQueue;
  const mailer: Mailer = { send: async (m) => void mailed.push(m) };
  const secret = process.env['SESSION_SECRET'];

  beforeAll(async () => {
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    sql = testPool({ max: 4 });
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    graph = await seedGraph(ownerSql);
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    runner = new JobRunner(
      db,
      new WorkspaceResolver(db, new AuthzService(audit)),
      new PlatformContext(audit),
      [new FanOutHandler(queue), new DeliverHandler(queue), new SendEmailHandler(mailer)],
    );
    queued = [];
    mailed = [];
  });

  afterAll(async () => {
    process.env['SESSION_SECRET'] = secret;
    await sql.end();
    await ownerSql.end();
  });

  const mission = () => graph.rows['missions']!;
  const event = (
    eventType: 'mission.status_changed' | 'assignment.status_changed',
    data: Record<string, unknown>,
  ): OutboxEvent => ({
    eventId: randomUUID(),
    eventType,
    aggregateType: eventType.split('.')[0]!,
    aggregateId: eventType === 'mission.status_changed' ? mission() : graph.rows['assignments']!,
    data,
  });
  const fanOut = (e: OutboxEvent) => runner.run(systemEnvelope(FAN_OUT, e.eventId, e));
  const notice = (over: Partial<Notice> = {}): Notice => ({
    eventId: randomUUID(),
    kind: 'mission_published',
    subjectType: 'mission',
    subjectId: mission(),
    href: `/missions/${mission()}`,
    ...over,
  });
  const as = (who: SeededGraph['customer']) => ({
    tenantId: who.tenantId,
    userId: who.userId,
    membershipId: who.membershipId,
  });
  const centreOf = (who: SeededGraph['customer']) =>
    ownerDb
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.recipientId, who.userId), eq(notifications.tenantId, who.tenantId)),
      );

  describe('fanning out', () => {
    it('tells the customer their mission was published, in their workspace, as them', async () => {
      const e = event('mission.status_changed', { from: 'UNDER_REVIEW', to: 'QUOTED' });
      await fanOut(e);
      expect(queued).toEqual([
        {
          queue: 'notifications',
          envelope: envelopeAs(
            as(graph.customer),
            DELIVER,
            `${e.eventId}-${graph.customer.userId}`,
            {
              eventId: e.eventId,
              kind: 'mission_published',
              subjectType: 'mission',
              subjectId: mission(),
              href: `/missions/${mission()}`,
            },
          ),
        },
      ]);
    });

    it('tells the investigator of a new assignment, in their own workspace', async () => {
      await fanOut(
        event('mission.status_changed', { from: 'PAID', to: 'ASSIGNED', actorKind: 'SYSTEM' }),
      );
      expect(queued).toHaveLength(1);
      expect(queued[0]!.envelope).toMatchObject({
        ...as(graph.supplier),
        payload: { kind: 'assignment_new', href: '/missions' },
      });
    });

    it.each([
      [
        { from: 'PENDING_ACCEPTANCE', to: 'ACCEPTED', actorKind: 'INVESTIGATOR' },
        'assignment_accepted',
      ],
      [
        { from: 'PENDING_ACCEPTANCE', to: 'CANCELLED', actorKind: 'INVESTIGATOR' },
        'assignment_declined',
      ],
      [
        { from: 'IN_PROGRESS', to: 'REPORT_SUBMITTED', actorKind: 'INVESTIGATOR' },
        'assignment_report_ready',
      ],
    ])('tells the customer of an assignment %j', async (data, kind) => {
      await fanOut(event('assignment.status_changed', data));
      expect(queued.map((q) => [q.envelope.userId, (q.envelope.payload as Notice).kind])).toEqual([
        [graph.customer.userId, kind],
      ]);
      expect((queued[0]!.envelope.payload as Notice).subjectId).toBe(mission());
    });

    it('tells nobody of what the customer did themselves', async () => {
      await fanOut(
        event('mission.status_changed', { from: 'DRAFT', to: 'SUBMITTED', actorKind: 'CUSTOMER' }),
      );
      expect(queued).toEqual([]);
    });

    it('tells nobody who has left the workspace the event concerns', async () => {
      // A Personal workspace always keeps its owner (tenant_has_active_owner), and in v1 an
      // investigator works from theirs — so this state is simulated, triggers aside, for one statement.
      const setStatus = (status: 'ACTIVE' | 'REMOVED') =>
        ownerSql.begin(async (tx) => {
          await tx`SET LOCAL session_replication_role = replica`;
          await tx`UPDATE tenant_memberships SET status = ${status} WHERE id = ${graph.supplier.membershipId}`;
        });
      await setStatus('REMOVED');
      try {
        await fanOut(event('mission.status_changed', { from: 'PAID', to: 'ASSIGNED' }));
        expect(queued).toEqual([]);
      } finally {
        await setStatus('ACTIVE');
      }
    });

    it('finds nobody for a subject that is not there', async () => {
      await fanOut({
        ...event('mission.status_changed', { from: 'PAID', to: 'ASSIGNED' }),
        aggregateId: randomUUID(),
      });
      await fanOut({
        ...event('assignment.status_changed', { from: 'PENDING_ACCEPTANCE', to: 'ACCEPTED' }),
        aggregateId: randomUUID(),
      });
      expect(queued).toEqual([]);
    });

    it('is asked for by a trigger, keyed on the event, as the system', async () => {
      const e = event('mission.status_changed', { from: 'UNDER_REVIEW', to: 'QUOTED' });
      await new NotificationTrigger('mission.status_changed', queue).handle(e);
      expect(queued).toEqual([
        { queue: 'notifications', envelope: systemEnvelope(FAN_OUT, `${e.eventId}-fan-out`, e) },
      ]);
    });
  });

  describe('delivering to one person', () => {
    it('puts it in their centre once, and queues its email as them', async () => {
      const n = notice({ kind: 'assignment_new', href: '/missions' });
      const job = envelopeAs(
        as(graph.supplier),
        DELIVER,
        `${n.eventId}-${graph.supplier.userId}`,
        n,
      );
      expect(await runner.run(job)).toBe('done');
      // A second delivery of the same event under another job id: still one notification.
      await runner.run({ ...job, jobId: 'again', key: `${job.key}-again` });
      const mine = (await centreOf(graph.supplier)).filter((r) => r.eventId === n.eventId);
      expect(mine).toMatchObject([
        { kind: 'assignment_new', subjectId: mission(), href: '/missions', readAt: null },
      ]);
      expect(queued[0]).toEqual({
        queue: 'notifications',
        envelope: envelopeAs(
          as(graph.supplier),
          SEND_EMAIL,
          `${n.eventId}-${graph.supplier.userId}-email`,
          n,
        ),
      });
    });

    it('queues no email to someone who turned the category off, and still fills their centre', async () => {
      // The graph's customer has turned activity email off.
      const n = notice();
      await runner.run(envelopeAs(as(graph.customer), DELIVER, `${n.eventId}-x`, n));
      expect(queued).toEqual([]);
      expect((await centreOf(graph.customer)).some((r) => r.eventId === n.eventId)).toBe(true);
    });
  });

  describe('emailing', () => {
    it('writes to a confirmed address, in the recipient’s language, with a link and the way to stop', async () => {
      await ownerSql`UPDATE users SET email_verified_at = now(), locale = 'hy' WHERE id = ${graph.customer.userId}`;
      const n = notice();
      const job = envelopeAs(as(graph.customer), SEND_EMAIL, `${n.eventId}-email`, n);
      await runner.run(job);
      const [row] = await ownerSql<
        { email: string }[]
      >`SELECT email FROM users WHERE id = ${graph.customer.userId}`;
      expect(mailed).toHaveLength(1);
      expect(mailed[0]).toMatchObject({
        to: row!.email,
        locale: 'hy',
        template: 'mission_published',
        variables: { url: `http://localhost:3000/missions/${mission()}` },
        idempotencyKey: job.key,
      });
      // Nothing about the mission itself: a kind, and a link to it.
      expect(Object.keys(mailed[0]!.variables)).toEqual(['url']);
      const token = new URL(mailed[0]!.unsubscribeUrl!).searchParams.get('token');
      expect(readUnsubscribeToken(token, 's'.repeat(32))).toEqual({
        ...as(graph.customer),
        category: 'activity',
      });
    });

    it('writes nothing to an address not yet confirmed', async () => {
      await ownerSql`UPDATE users SET email_verified_at = NULL WHERE id = ${graph.supplier.userId}`;
      const n = notice({ kind: 'assignment_new', href: '/missions' });
      await runner.run(envelopeAs(as(graph.supplier), SEND_EMAIL, `${n.eventId}-email`, n));
      expect(mailed).toEqual([]);
    });
  });

  it.each([
    [FAN_OUT, () => null],
    [FAN_OUT, () => ({ eventId: 'x' })],
    [
      FAN_OUT,
      () => ({
        eventId: randomUUID(),
        eventType: 'mission.status_changed',
        aggregateId: randomUUID(),
      }),
    ],
    [
      FAN_OUT,
      () => ({
        eventId: randomUUID(),
        eventType: 'quote.created',
        aggregateId: randomUUID(),
        data: { to: 'X' },
      }),
    ],
    [DELIVER, () => ({ ...notice(), href: 'https://evil.example' })],
    [DELIVER, () => ({ ...notice(), kind: 'marketing' })],
    [SEND_EMAIL, () => undefined],
  ])('refuses a %s it cannot trust, for good', async (command, payloadOf) => {
    const payload = payloadOf();
    const job =
      command === FAN_OUT
        ? systemEnvelope(command, randomUUID(), payload)
        : envelopeAs(as(graph.customer), command, randomUUID(), payload);
    await expect(runner.run(job)).rejects.toEqual(new PermanentJobError('invalid_payload'));
  });
});

describe('notifications end to end, through Redis', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  const open: Array<{ close(): Promise<void> }> = [];

  beforeAll(() => {
    sql = testPool({ max: 4 });
    ownerSql = testPool({ role: 'owner' });
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((o) => o.close()));
  });
  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  it('turns a published mission into one notification and one email for its customer', async () => {
    const graph = await seedGraph(ownerSql);
    await ownerSql`UPDATE users SET email_verified_at = now() WHERE id = ${graph.customer.userId}`;
    // The graph seeds this customer with activity email off; this one wants it.
    await ownerSql`UPDATE notification_preferences SET enabled = true WHERE user_id = ${graph.customer.userId}`;
    await ownerSql`UPDATE outbox_events SET published_at = now() WHERE published_at IS NULL`;
    const db = scopedDb(sql);
    const platform = new PlatformContext(new AuditService(db));
    const config = { redisUrl: TEST_REDIS_URL, prefix: testQueuePrefix() };
    const jobQueue = new JobQueue(config);
    let delivered!: () => void;
    const sent = new Promise<void>((resolve) => (delivered = resolve));
    const mails: MailMessage[] = [];
    const handlers = [
      new OutboxDeliveryHandler([new NotificationTrigger('mission.status_changed', jobQueue)]),
      new FanOutHandler(jobQueue),
      new DeliverHandler(jobQueue),
      new SendEmailHandler({ send: async (m) => void (mails.push(m), delivered()) }),
    ];
    const runner = new JobRunner(
      db,
      new WorkspaceResolver(db, new AuthzService(new AuditService(db))),
      platform,
      handlers,
    );
    const workers = new JobWorkers(config, runner, new DeadLetters(db, platform), handlers);
    open.push(workers, jobQueue);

    // A moderator's publication, as the system writes it until T-051 gives moderators a screen.
    const eventId = await platform.asSystem('assignment.create_from_payment', {}, async () => {
      const [row] = await db
        .insert(schema.outboxEvents)
        .values({
          aggregateType: 'mission',
          aggregateId: graph.rows['missions']!,
          eventType: 'mission.status_changed',
          payload: {
            missionId: graph.rows['missions'],
            from: 'UNDER_REVIEW',
            to: 'QUOTED',
            actorKind: 'STAFF',
          },
        })
        .returning({ id: schema.outboxEvents.id });
      return row!.id;
    });
    await new OutboxDispatcher(db, platform, jobQueue).dispatchOnce();
    await workers.start(() => undefined);
    await sent;

    expect(mails.map((m) => m.template)).toEqual(['mission_published']);
    const centre = await ownerSql`
      SELECT kind FROM notifications WHERE recipient_id = ${graph.customer.userId}
        AND tenant_id = ${graph.customer.tenantId} AND event_id = ${eventId}`;
    expect(centre.map((r) => r.kind)).toEqual(['mission_published']);
  });
});
