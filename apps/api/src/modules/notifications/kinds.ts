import type { MailTemplate } from '../../common/mail/mailer';

/**
 * What a notification can be about (T-036, plan.md §13), and to whom. Each kind is also the email
 * template it sends, so its copy exists in every language (the catalogs' parity spec holds that).
 *
 * `activity` is the one category a person can stop by email; the in-app centre always has it.
 */
export const NOTIFICATION_KINDS = [
  'mission_published',
  'mission_returned',
  'mission_rejected',
  'assignment_new',
  'assignment_accepted',
  'assignment_declined',
  'assignment_report_ready',
] as const satisfies readonly MailTemplate[];
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationCategory = 'activity';
export const CATEGORY_OF: Readonly<Record<NotificationKind, NotificationCategory>> = {
  mission_published: 'activity',
  mission_returned: 'activity',
  mission_rejected: 'activity',
  assignment_new: 'activity',
  assignment_accepted: 'activity',
  assignment_declined: 'activity',
  assignment_report_ready: 'activity',
};

/** Which party of the subject a notification goes to. */
export type Party = 'customer' | 'investigator';

export interface Plan {
  kind: NotificationKind;
  to: Party;
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
 * Where a notification leads, on the app. A mission's own page for its customer; an investigator
 * has no assignment screen yet (T-121), so theirs leads to Missions.
 */
export function hrefFor(to: Party, missionId: string): string {
  return to === 'customer' ? `/missions/${missionId}` : '/missions';
}
