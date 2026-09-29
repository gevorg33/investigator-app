import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { inArray, isNull, sql } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../../database/database.module';
import { outboxEvents } from '../../database/schema';
import { PlatformContext } from '../context/platform-context';
import type { JobEnvelope } from './job';
import { JobQueue } from './job-queue';
import { OUTBOX_DELIVER, type OutboxEvent } from './outbox-delivery.handler';

/** How many events one pass hands off; the rest wait for the next. */
export const DISPATCH_BATCH = 100;
/** How long the dispatcher rests when the outbox is empty. */
export const DISPATCH_IDLE_MS = 1_000;

type OutboxRow = typeof outboxEvents.$inferSelect;

/**
 * The job that delivers one outbox event: queued in the workspace that produced it, by the user and
 * membership that produced it — re-read when it runs — or as the system when the system did.
 * Keyed on the event, so however many times it is handed off, it is delivered once.
 */
export function deliveryOf(row: OutboxRow): JobEnvelope<OutboxEvent> {
  return {
    jobId: `outbox-${row.id}`,
    key: row.id,
    command: OUTBOX_DELIVER,
    tenantId: row.tenantId,
    userId: row.userId,
    membershipId: row.membershipId,
    payload: {
      eventId: row.id,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      data: row.payload,
    },
  };
}

/**
 * The outbox dispatcher (T-082): the one reader of `outbox_events`, and it reads them in the system
 * context — row-level security admits nobody else. It hands each event off as a job in its
 * producer's context and marks it published in the same transaction; if that transaction does not
 * commit, the events are handed off again, and the job's key makes the repeat do nothing.
 *
 * `SKIP LOCKED`: several dispatchers may run, and each takes events the others are not holding.
 */
@Injectable()
export class OutboxDispatcher {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly platform: PlatformContext,
    private readonly queue: JobQueue,
  ) {}

  /**
   * Hands events off until `signal` aborts. The system context is entered — and audited — once, for
   * the dispatcher's life, not once a second.
   */
  run(signal: AbortSignal, sleep = rest): Promise<void> {
    return this.platform.asSystem('outbox.dispatch', { correlationId: randomUUID() }, async () => {
      while (!signal.aborted) {
        const handed = await this.db.transaction((tx) => this.handOff(tx));
        if (handed < DISPATCH_BATCH) await sleep(DISPATCH_IDLE_MS, signal);
      }
    });
  }

  /** One pass, for a caller that is not a long-running dispatcher — a test, or a one-off. */
  dispatchOnce(): Promise<number> {
    return this.platform.asSystem('outbox.dispatch', { correlationId: randomUUID() }, () =>
      this.db.transaction((tx) => this.handOff(tx)),
    );
  }

  private async handOff(tx: Tx): Promise<number> {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(outboxEvents.occurredAt)
      .limit(DISPATCH_BATCH)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return 0;
    for (const row of rows) await this.queue.enqueue('events', deliveryOf(row));
    await tx
      .update(outboxEvents)
      .set({ publishedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` })
      .where(
        inArray(
          outboxEvents.id,
          rows.map((r) => r.id),
        ),
      );
    return rows.length;
  }
}

/** Waits `ms`, or less if `signal` aborts first. */
export function rest(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
