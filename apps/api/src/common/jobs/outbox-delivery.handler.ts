import { Inject, Injectable } from '@nestjs/common';
import type { Tx } from '../../database/database.module';
import type { JobHandler } from './job';

export const OUTBOX_DELIVER = 'outbox.deliver';

/** An outbox event as its subscribers receive it: references, never content (outbox.ts). */
export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly data: unknown;
}

/**
 * Something that acts on an event — a notification (T-036), the moderation queue (T-051) — run in
 * the producer's context, inside the delivery's transaction. None exists yet; each arrives with its
 * own task and is listed in `EVENT_SUBSCRIBERS`.
 */
export interface EventSubscriber {
  readonly eventType: string;
  handle(event: OutboxEvent, tx: Tx): Promise<void>;
}
export const EVENT_SUBSCRIBERS = Symbol('EVENT_SUBSCRIBERS');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delivers one outbox event to its subscribers (T-082). The runner has already restored the
 * producer's context and claimed the event's id in `job_runs`, in this same transaction — so a
 * subscriber's effect happens once, or not at all, however often the event is handed off.
 */
@Injectable()
export class OutboxDeliveryHandler implements JobHandler<OutboxEvent> {
  readonly command = OUTBOX_DELIVER;
  readonly queue = 'events' as const;

  constructor(
    @Inject(EVENT_SUBSCRIBERS) private readonly subscribers: readonly EventSubscriber[],
  ) {}

  parse(payload: unknown): OutboxEvent {
    const p = (payload ?? {}) as Record<string, unknown>;
    const ok =
      typeof p['eventId'] === 'string' &&
      UUID.test(p['eventId']) &&
      typeof p['eventType'] === 'string' &&
      typeof p['aggregateType'] === 'string' &&
      typeof p['aggregateId'] === 'string' &&
      UUID.test(p['aggregateId']) &&
      'data' in p;
    if (!ok) throw new Error('not an outbox event');
    return p as unknown as OutboxEvent;
  }

  async run(event: OutboxEvent, tx: Tx): Promise<void> {
    for (const subscriber of this.subscribers) {
      if (subscriber.eventType === event.eventType) await subscriber.handle(event, tx);
    }
  }
}
