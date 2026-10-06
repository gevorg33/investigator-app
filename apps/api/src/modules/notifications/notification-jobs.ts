import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { appUrl } from '@investigator/config';
import { currentContext } from '../../common/context/execution-context';
import {
  envelopeAs,
  envelopeFor,
  systemEnvelope,
  type JobEnvelope,
  type JobHandler,
} from '../../common/jobs/job';
import { JobQueue } from '../../common/jobs/job-queue';
import type { EventSubscriber, OutboxEvent } from '../../common/jobs/outbox-delivery.handler';
import { MAILER, type Mailer } from '../../common/mail/mailer';
import type { Tx } from '../../database/database.module';
import {
  aiPlans,
  assignments,
  investigatorProfiles,
  missions,
  notificationPreferences,
  notifications,
  tenantMemberships,
  users,
} from '../../database/schema';
import { PLAN_ENDED } from '../ai/plans/ai-plans.service';
import {
  assistantHref,
  assistantPlanKind,
  assignmentPlan,
  CATEGORY_OF,
  hrefFor,
  isEmailed,
  missionPlan,
  NOTIFICATION_KINDS,
  type EmailedKind,
  type NotificationKind,
  type Party,
  type StatusChange,
} from './kinds';
import { unsubscribeToken } from './unsubscribe';

export const FAN_OUT = 'notifications.fan_out';
export const DELIVER = 'notifications.deliver';
export const SEND_EMAIL = 'notifications.email';

/** The events notifications come from — each also the eventType a trigger listens for. */
export const NOTIFYING_EVENTS = [
  'mission.status_changed',
  'assignment.status_changed',
  PLAN_ENDED,
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One notification for one person, as it travels between the jobs: references only. */
export interface Notice<K extends NotificationKind = NotificationKind> {
  eventId: string;
  kind: K;
  subjectType: 'mission' | 'ai_plan';
  subjectId: string;
  href: string;
}

function parseNotice(payload: unknown): Notice {
  const p = (payload ?? {}) as Record<string, unknown>;
  const ok =
    typeof p['eventId'] === 'string' &&
    UUID.test(p['eventId']) &&
    NOTIFICATION_KINDS.includes(p['kind'] as NotificationKind) &&
    (p['subjectType'] === 'mission' || p['subjectType'] === 'ai_plan') &&
    typeof p['subjectId'] === 'string' &&
    UUID.test(p['subjectId']) &&
    typeof p['href'] === 'string' &&
    /^\/[^/\\]/.test(p['href']);
  if (!ok) throw new Error('not a notice');
  return p as unknown as Notice;
}

/** A notice that is also an email: a kind that stays in the centre is never mailed. */
function parseEmailNotice(payload: unknown): Notice<EmailedKind> {
  const notice = parseNotice(payload);
  if (!isEmailed(notice.kind)) throw new Error('not an emailed notice');
  return notice as Notice<EmailedKind>;
}

/**
 * Listens for an event that may concern someone other than the person who caused it, and hands the
 * question of whom to the system (T-036). The producer's context cannot answer it — a moderator
 * cannot read the customer's rows, and should not — so this queues a fan-out job in the system
 * context, keyed on the event: however often the event is delivered, it is fanned out once. The key
 * is the event's id **and** `fan-out`: a job's key is unique per workspace, not per command, and the
 * delivery that runs this trigger has already claimed the bare event id in the same system context.
 */
export class NotificationTrigger implements EventSubscriber {
  constructor(
    readonly eventType: (typeof NOTIFYING_EVENTS)[number],
    private readonly queue: JobQueue,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    await this.queue.enqueue(
      'notifications',
      systemEnvelope(FAN_OUT, `${event.eventId}-fan-out`, event),
    );
  }
}

/**
 * Decides who an event concerns and hands each of them their notification (T-036). Runs in the
 * system context — the one place that may read both parties of a mission or an assignment — and
 * hands off per person in **their** workspace, as that person, re-read when the job runs (T-082).
 * A party with no active membership there is not notified.
 */
@Injectable()
export class FanOutHandler implements JobHandler<OutboxEvent> {
  readonly command = FAN_OUT;
  readonly queue = 'notifications' as const;

  constructor(private readonly jobs: JobQueue) {}

  parse(payload: unknown): OutboxEvent {
    const p = (payload ?? {}) as Record<string, unknown>;
    const data = p['data'] as Record<string, unknown> | undefined;
    const ok =
      typeof p['eventId'] === 'string' &&
      UUID.test(p['eventId']) &&
      NOTIFYING_EVENTS.includes(p['eventType'] as (typeof NOTIFYING_EVENTS)[number]) &&
      typeof p['aggregateId'] === 'string' &&
      UUID.test(p['aggregateId']) &&
      typeof data?.['to'] === 'string';
    if (!ok) throw new Error('not a notifying event');
    return p as unknown as OutboxEvent;
  }

  async run(event: OutboxEvent, tx: Tx): Promise<void> {
    if (event.eventType === PLAN_ENDED) return this.planEnded(event, tx);
    const change = event.data as StatusChange;
    const byMission = event.eventType === 'mission.status_changed';
    const plans = byMission ? missionPlan(change) : assignmentPlan(change);
    if (plans.length === 0) return;

    const [assignment] = await tx
      .select({
        missionId: assignments.missionId,
        customerId: assignments.customerId,
        customerTenantId: assignments.customerTenantId,
        investigatorId: investigatorProfiles.userId,
        supplierTenantId: assignments.supplierTenantId,
      })
      .from(assignments)
      .innerJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(
        byMission
          ? eq(assignments.missionId, event.aggregateId)
          : eq(assignments.id, event.aggregateId),
      );
    const [mission] = byMission
      ? await tx
          .select({ customerId: missions.customerId, customerTenantId: missions.customerTenantId })
          .from(missions)
          .where(eq(missions.id, event.aggregateId))
      : [];
    const missionId = byMission ? event.aggregateId : assignment?.missionId;
    const party: Record<Party, { userId: string; tenantId: string } | undefined> = {
      customer: mission
        ? { userId: mission.customerId, tenantId: mission.customerTenantId }
        : assignment && { userId: assignment.customerId, tenantId: assignment.customerTenantId },
      investigator: assignment && {
        userId: assignment.investigatorId,
        tenantId: assignment.supplierTenantId,
      },
    };

    for (const plan of plans) {
      const who = party[plan.to];
      if (who === undefined || missionId === undefined) continue;
      await this.deliver(tx, who, {
        eventId: event.eventId,
        kind: plan.kind,
        subjectType: 'mission',
        subjectId: missionId,
        href: hrefFor(plan.to, missionId),
      });
    }
  }

  /**
   * An assistant plan that ended (T-226), told to its own person in the workspace it ran in. What it
   * means is read from the plan's row as it stands — never from the event — and a plan erased with its
   * conversation since tells nobody.
   */
  private async planEnded(event: OutboxEvent, tx: Tx): Promise<void> {
    const [plan] = await tx
      .select({
        tenantId: aiPlans.tenantId,
        userId: aiPlans.userId,
        sessionId: aiPlans.sessionId,
        status: aiPlans.status,
        confirmedAt: aiPlans.confirmedAt,
      })
      .from(aiPlans)
      .where(eq(aiPlans.id, event.aggregateId));
    const kind = plan && assistantPlanKind(plan);
    if (kind === undefined) return;
    await this.deliver(tx, plan!, {
      eventId: event.eventId,
      kind,
      subjectType: 'ai_plan',
      subjectId: event.aggregateId,
      href: assistantHref(plan!.sessionId),
    });
  }

  /** Hands one notice to its person, as them, in that workspace — if they are still a member there. */
  private async deliver(
    tx: Tx,
    who: { userId: string; tenantId: string },
    notice: Notice,
  ): Promise<void> {
    const [membership] = await tx
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, who.tenantId),
          eq(tenantMemberships.userId, who.userId),
          eq(tenantMemberships.status, 'ACTIVE'),
        ),
      );
    if (membership === undefined) return;
    await this.jobs.enqueue(
      'notifications',
      envelopeAs(
        { tenantId: who.tenantId, userId: who.userId, membershipId: membership.id },
        DELIVER,
        `${notice.eventId}-${who.userId}`,
        notice,
      ),
    );
  }
}

/**
 * Puts one notification in its recipient's centre, as the recipient, and — for a kind that emails,
 * unless they turned the category off — queues its email (T-036). One notification per (event, recipient); one email per
 * (event, recipient, channel), each its own job keyed so.
 */
@Injectable()
export class DeliverHandler implements JobHandler<Notice> {
  readonly command = DELIVER;
  readonly queue = 'notifications' as const;

  constructor(private readonly jobs: JobQueue) {}

  parse = parseNotice;

  async run(notice: Notice, tx: Tx): Promise<void> {
    await tx
      .insert(notifications)
      .values({
        eventId: notice.eventId,
        kind: notice.kind,
        subjectType: notice.subjectType,
        subjectId: notice.subjectId,
        href: notice.href,
      })
      .onConflictDoNothing();
    if (!isEmailed(notice.kind)) return;
    const [choice] = await tx
      .select({ enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.category, CATEGORY_OF[notice.kind]),
          eq(notificationPreferences.channel, 'email'),
        ),
      );
    if (choice?.enabled === false) return;
    const me = currentContext()!;
    await this.jobs.enqueue(
      'notifications',
      envelopeFor(SEND_EMAIL, `${notice.eventId}-${me.userId}-email`, notice),
    );
  }
}

/**
 * Emails one notification to its recipient, in their language, as they are today (T-036): an
 * address not yet confirmed gets nothing. The mail says what kind of thing happened and links to
 * it — never the thing itself — and carries the way to stop this category, here and in the
 * `List-Unsubscribe` header. The job's key is the provider's idempotency key.
 */
@Injectable()
export class SendEmailHandler implements JobHandler<Notice<EmailedKind>> {
  readonly command = SEND_EMAIL;
  readonly queue = 'notifications' as const;

  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  parse = parseEmailNotice;

  async run(
    notice: Notice<EmailedKind>,
    tx: Tx,
    envelope: JobEnvelope<Notice<EmailedKind>>,
  ): Promise<void> {
    const me = currentContext()!;
    const [person] = await tx
      .select({ email: users.email, locale: users.locale, confirmed: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, me.userId));
    if (person?.confirmed == null) return;
    const token = unsubscribeToken(
      {
        userId: me.userId,
        tenantId: me.tenantId,
        membershipId: me.membershipId,
        category: CATEGORY_OF[notice.kind],
      },
      process.env['SESSION_SECRET']!,
    );
    await this.mailer.send({
      to: person.email,
      locale: person.locale,
      template: notice.kind,
      variables: { url: appUrl(notice.href) },
      idempotencyKey: envelope.key,
      unsubscribeUrl: appUrl(`/api/v1/notifications/unsubscribe?token=${token}`),
    });
  }
}
