import type { MailTemplate } from '../../common/mail/mailer';

/**
 * What a notification can be about (T-036, plan.md §13), and to whom. A kind that also emails is the
 * email template it sends, so its copy exists in every language (the catalogs' parity spec holds
 * that); a kind that stays in the centre has only its line there.
 *
 * `activity` is the one category a person can stop by email; the in-app centre always has it.
 */
export const EMAILED_KINDS = [
  'mission_published',
  'mission_returned',
  'mission_rejected',
  'assignment_new',
  'assignment_accepted',
  'assignment_declined',
  'assignment_report_ready',
] as const satisfies readonly MailTemplate[];
/**
 * In the centre only (T-226): a plan the assistant was running for the person failed, or a plan they
 * confirmed was voided before it ran. They learn it where they would act on it — the conversation
 * already says how it ended — so it is not worth an email.
 */
export const IN_APP_KINDS = ['assistant_plan_failed', 'assistant_plan_voided'] as const;
export const NOTIFICATION_KINDS = [...EMAILED_KINDS, ...IN_APP_KINDS] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type EmailedKind = (typeof EMAILED_KINDS)[number];
export type NotificationCategory = 'activity';
export const CATEGORY_OF: Readonly<Record<EmailedKind, NotificationCategory>> = {
  mission_published: 'activity',
  mission_returned: 'activity',
  mission_rejected: 'activity',
  assignment_new: 'activity',
  assignment_accepted: 'activity',
  assignment_declined: 'activity',
  assignment_report_ready: 'activity',
};

export const isEmailed = (kind: NotificationKind): kind is EmailedKind =>
  (EMAILED_KINDS as readonly string[]).includes(kind);

/** Which party of the subject a notification goes to. */
export type Party = 'customer' | 'investigator';

export interface Plan {
  kind: NotificationKind;
  to: Party;
}

/** An assistant plan as it ended, re-read from its row (T-226). */
export interface PlanEnding {
  status: string;
  confirmedAt: Date | null;
}

/** A status change as the outbox carries it. */
export interface StatusChange {
  from: string | null;
  to: string;
  actorKind?: string | undefined;
}

/**
 * The notifications a mission's status change means. Only changes someone other than the recipient
 * made — a customer is not told about what they just did themselves.
 */
export function missionPlan(change: StatusChange): Plan[] {
  if (change.from === 'UNDER_REVIEW' && change.to === 'QUOTED') {
    return [{ kind: 'mission_published', to: 'customer' }];
  }
  if (change.from === 'UNDER_REVIEW' && change.to === 'DRAFT') {
    return [{ kind: 'mission_returned', to: 'customer' }];
  }
  if (change.to === 'REJECTED') return [{ kind: 'mission_rejected', to: 'customer' }];
  if (change.to === 'ASSIGNED') return [{ kind: 'assignment_new', to: 'investigator' }];
  return [];
}

/** The notifications an assignment's status change means. */
export function assignmentPlan(change: StatusChange): Plan[] {
  if (change.from === 'PENDING_ACCEPTANCE' && change.to === 'ACCEPTED') {
    return [{ kind: 'assignment_accepted', to: 'customer' }];
  }
  // Declined by the investigator; a customer's own withdrawal, or the window closing, is not this.
  if (
    change.from === 'PENDING_ACCEPTANCE' &&
    change.to === 'CANCELLED' &&
    change.actorKind === 'INVESTIGATOR'
  ) {
    return [{ kind: 'assignment_declined', to: 'customer' }];
  }
  if (change.to === 'REPORT_SUBMITTED')
    return [{ kind: 'assignment_report_ready', to: 'customer' }];
  return [];
}

/**
 * What an assistant plan's ending tells its person (T-226). Only an ending they did not cause and may
 * not be watching: a FAILED plan, or one they confirmed that was voided before it ran. Completing is
 * what they asked for; a decline is their own; a proposal that was never confirmed was never theirs to
 * wait for.
 */
export function assistantPlanKind(plan: PlanEnding): NotificationKind | undefined {
  if (plan.status === 'FAILED') return 'assistant_plan_failed';
  if (plan.status === 'CANCELLED' && plan.confirmedAt !== null) return 'assistant_plan_voided';
  return undefined;
}

/**
 * Where a notification leads, on the app. A mission's own page for its customer; an investigator
 * has no assignment screen yet (T-121), so theirs leads to Missions.
 */
export function hrefFor(to: Party, missionId: string): string {
  return to === 'customer' ? `/missions/${missionId}` : '/missions';
}

/**
 * Where an assistant plan's notification leads: the app, naming the conversation it ended in. The
 * assistant is a panel rather than a page, so the conversation travels as a parameter.
 */
export const assistantHref = (sessionId: string): string => `/?assistant=${sessionId}`;
