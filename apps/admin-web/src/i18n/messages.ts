/**
 * The staff console's strings, by key (localization skill: keys only, never a literal in a
 * component). English only for now; the keys are the contract that carries over when catalogs
 * arrive, as in app-web. ICU-style `{name}` arguments are filled by {@link t}.
 */
export const LOCALE = 'en';

const en = {
  'app.name': 'Investigator Staff',
  'shell.nav.label': 'Console',
  'shell.skip_to_content': 'Skip to content',
  'shell.verification': 'Verification',
  'shell.moderation': 'Missions',
  'shell.sign_out': 'Sign out',
  'shell.signed_in_as': 'Signed in as {email}',

  'sign_in.title': 'Staff sign-in',
  'sign_in.body':
    'The console is for platform staff. Your access to each queue comes with your staff scopes.',
  'sign_in.email': 'Email',
  'sign_in.password': 'Password',
  'sign_in.submit': 'Sign in',
  'sign_in.failed': 'That email and password do not match a staff account we can sign in.',

  'staff_only.title': 'This console is for platform staff',
  'staff_only.body':
    'You are signed in, but not as staff. Sign out, and sign in with a staff account.',

  'verification.title': 'Verification',
  'verification.intro': 'Applications waiting for a decision, oldest first.',
  'verification.no_scope.title': 'You do not have the verification scope',
  'verification.no_scope.body':
    'Reviewing verification applications needs the VERIFICATION staff scope. Ask whoever manages staff access.',
  'verification.empty.title': 'Nothing to review',
  'verification.empty.body':
    'No application is waiting for a decision. New ones appear here, oldest first.',
  'verification.item.title': 'Application from {date}',
  'verification.item.documents': '{count, plural, one {# document} other {# documents}}',
  'verification.item.profile': 'Profile {id}',
  'verification.next': 'Next applications',
  'verification.first': 'Back to the oldest',

  'review.back': 'All applications',
  'review.title': 'Application from {date}',
  'review.status.SUBMITTED': 'Waiting for a decision',
  'review.status.APPROVED': 'Approved',
  'review.status.REJECTED': 'Rejected',
  'review.profile': 'Applicant',
  'review.profile_status': 'Profile status: {status}',
  'review.no_headline': 'No headline on the profile',
  'review.declared.title': 'What was declared',
  'review.declared.note':
    'As recorded when the application was submitted — not the profile as it is now.',
  'review.declared.specialties': 'Specialties',
  'review.declared.areas': 'Service areas',
  'review.declared.none': 'None declared',
  'review.declared.unlisted': 'A specialty no longer in the taxonomy ({id})',
  'review.documents.title': 'Documents',
  'review.documents.note':
    'Each opening is recorded against this application. A link lasts five minutes and is never shown.',
  'review.documents.open': 'Open document {n}',
  'review.documents.kind': '{type}, {size}',
  'review.documents.unknown_size': 'size unknown',
  'review.documents.blocked':
    'Your browser blocked the new tab. Allow pop-ups for this console, then open the document again.',
  'review.documents.scan.PENDING': 'Still being scanned — it cannot be opened yet',
  'review.documents.scan.INFECTED': 'Flagged by the malware scan — it cannot be opened',
  'review.documents.scan.FAILED': 'The scan failed — it cannot be opened',
  'review.trail.title': 'Decision trail',
  'review.trail.note': 'Every application this profile has made, newest first.',
  'review.trail.this': 'This application',
  'review.trail.submitted': 'Submitted {date}',
  'review.trail.decided': '{outcome} on {date} by {by}',
  'review.trail.waiting': 'No decision yet',
  'review.own': 'This is your own application. Someone else must review it.',
  'review.decided': 'This application has been decided. Its decision is in the trail below.',

  'decision.open': 'Record a decision',
  'decision.title': 'Your decision',
  'decision.description':
    'A decision covers everything declared. The reason is recorded with it; for a rejection, it is what the applicant reads.',
  'decision.outcome': 'Outcome',
  'decision.approve': 'Approve',
  'decision.reject': 'Reject',
  'decision.reason': 'Reason',
  'decision.reason_hint': 'Required for both outcomes.',
  'decision.submit': 'Record the decision',
  'decision.cancel': 'Cancel',
  'decision.conflict':
    'This application changed while you were deciding — it may have been decided by someone else. Reload to see it.',

  'moderation.title': 'Missions to review',
  'moderation.intro':
    'Every mission waits here until a moderator publishes it. The most sensitive risk band comes first, then whoever has waited longest.',
  'moderation.no_scope.title': 'You do not have the moderation scope',
  'moderation.no_scope.body':
    'Reviewing missions needs the MODERATION staff scope. Ask whoever manages staff access.',
  'moderation.empty.title': 'Nothing to review',
  'moderation.empty.body':
    'No mission is waiting for a decision. New ones appear here as they are submitted.',
  'moderation.untitled': 'Untitled mission',
  'moderation.item.queued': 'Queued {ago}',
  'moderation.item.deadline': 'Needed by {date}',
  'moderation.item.flags': '{count, plural, one {# flag} other {# flags}}',
  'moderation.next': 'Next missions',
  'moderation.first': 'Back to the top',
  'moderation.band.STANDARD': 'Standard risk',
  'moderation.band.ELEVATED': 'Elevated risk',
  'moderation.band.HIGH': 'High risk',
  'moderation.band.RESTRICTED': 'Restricted',
  'moderation.screening_outcome.PRIORITY_REVIEW': 'Priority',
  'moderation.screening_outcome.ROUTINE_REVIEW': 'Routine',

  'moderation.latency_link': 'Review times',

  'latency.title': 'Review times',
  'latency.intro':
    'How long customers waited for a moderator’s decision, and what was decided, by category and risk band.',
  'latency.purpose':
    'This is what a decision to publish a category without review would be made on — with counsel’s confirmation, never from here. Nothing opens from this page.',
  'latency.back': 'Missions to review',
  'latency.period.label': 'Period',
  'latency.period.30': 'Last 30 days',
  'latency.period.90': 'Last 90 days',
  'latency.period.365': 'Last year',
  'latency.empty.title': 'No decisions in this period',
  'latency.empty.body': 'Review times appear here once moderators decide missions.',
  'latency.uncategorised': 'No category',
  'latency.decided': 'Decisions',
  'latency.median': 'Median wait',
  'latency.p90': '9 in 10 decided within',
  'latency.longest': 'Longest wait',
  'latency.outcomes': 'Outcomes',
  'latency.outcomes_value': '{published} published · {changes} returned · {rejected} rejected',

  'mission.back': 'All missions',
  'mission.status.UNDER_REVIEW': 'Waiting for a decision',
  'mission.status.QUOTED': 'Published',
  'mission.status.REJECTED': 'Rejected',
  'mission.status.DRAFT': 'Returned for changes',
  'mission.status.other': 'No longer under review',
  'mission.queued': 'Queued {date} — {ago}',
  'mission.brief.title': 'The brief',
  'mission.brief.note':
    'As the customer submitted it. Who the customer is is not shown: it is not what you decide.',
  'mission.brief.description': 'What they need',
  'mission.brief.purpose': 'Why',
  'mission.brief.category': 'Category',
  'mission.brief.category_unlisted': 'A category no longer in the taxonomy ({id})',
  'mission.brief.place': 'Where',
  'mission.brief.languages': 'Languages',
  'mission.brief.timing': 'When',
  'mission.brief.timing_value': 'Start by {start}, needed by {deadline}',
  'mission.brief.deadline_value': 'Needed by {deadline}',
  'mission.brief.budget': 'Budget',
  'mission.brief.relationship': 'Their relationship to the subject',
  'mission.brief.tags': 'Tags',
  'mission.brief.protective_order': 'A protective order involving the subject',
  'mission.brief.protective_order.yes': 'Declared',
  'mission.brief.protective_order.no': 'None declared',
  'mission.brief.none': 'Not given',
  'mission.relationship.SELF_OR_OWN_ORGANISATION': 'Themself or their own organisation',
  'mission.relationship.EMPLOYER': 'Their employer',
  'mission.relationship.BUSINESS_RELATIONSHIP': 'A business relationship',
  'mission.relationship.LEGAL_REPRESENTATIVE': 'They represent someone legally',
  'mission.relationship.FAMILY_MEMBER': 'A family member',
  'mission.relationship.PARTNER_OR_SPOUSE': 'A partner or spouse',
  'mission.relationship.FORMER_PARTNER': 'A former partner or spouse',
  'mission.relationship.NO_PERSONAL_RELATIONSHIP': 'No personal connection',
  'mission.relationship.OTHER': 'Something else',
  'mission.screening.title': 'Screening',
  'mission.screening.note':
    'What sorted this mission in the queue. It decides nothing: a clean screening is not an approval, and a flag is not a refusal.',
  'mission.screening.band': 'Risk band',
  'mission.screening.outcome': 'Queue',
  'mission.screening.flags': 'Rules matched',
  'mission.screening.no_flags': 'None',
  'mission.screening.ruleset': 'Ruleset {version}, screened {date}',
  'mission.screening.missing': 'This mission has no screening record. Do not decide it; report it.',
  'mission.tags.suggested': 'suggested',
  'mission.tags.confirmed': 'confirmed',
  'mission.ai.title': 'AI classification — input only',
  'mission.ai.note':
    'A model’s reading of the mission. It never decides, and it chooses nothing for you below.',
  'mission.ai.none': 'No AI classification for this mission.',
  'mission.party': 'This is your own mission. Someone else must decide it.',
  'mission.decided': 'This mission is no longer under review. The decisions on it are below.',
  'mission.decisions.title': 'Decisions',
  'mission.decisions.note': 'Every decision on this mission, across its submissions, oldest first.',
  'mission.decisions.none': 'No decision yet.',
  'mission.decisions.entry': '{outcome} on {date} by {by}',
  'mission.decisions.customer_read': 'The customer read',
  'mission.decisions.reason': 'Reason',
  'mission.decisions.internal_note': 'Internal note',
  'mission.outcome.PUBLISHED': 'Published',
  'mission.outcome.REJECTED': 'Rejected',
  'mission.outcome.CHANGES_REQUESTED': 'Returned for changes',

  'moderate.open': 'Decide',
  'moderate.title': 'Your decision',
  'moderate.description':
    'Publishing makes the mission visible to investigators. Nothing is chosen for you: pick an outcome and write why.',
  'moderate.outcome': 'Outcome',
  'moderate.publish': 'Publish',
  'moderate.reject': 'Reject',
  'moderate.request_changes': 'Return for changes',
  'moderate.reason': 'Reason',
  'moderate.reason_hint': 'Choose an outcome first. Required for all three.',
  'moderate.reason.customer': 'Reason — the customer reads this',
  'moderate.reason.customer_hint':
    'Shown to the customer exactly as you write it. Say what to change and why — never which rule matched.',
  'moderate.reason.staff': 'Reason — staff only',
  'moderate.reason.staff_hint': 'Recorded with the decision. The customer does not see it.',
  'moderate.tags': 'Tags to publish with',
  'moderate.tags_hint':
    'The customer’s suggestions are ticked. Keep the ones that fit, add any that are missing; only these narrow and order investigators’ browsing.',
  'moderate.tags_suggested': '{label} (suggested)',
  'moderate.note': 'Internal note (optional)',
  'moderate.note_hint': 'Staff only, never shown to the customer: what the reason should not say.',
  'moderate.submit': 'Record the decision',
  'moderate.cancel': 'Cancel',
  'moderate.conflict':
    'This mission changed while you were deciding — someone else may have decided it, or the customer cancelled it. Reload to see it.',

  'error.reference': 'Reference: {ref}',
  'error.auth.unauthenticated': 'You are not signed in, or your session has ended. Sign in again.',
  'error.auth.forbidden': 'You cannot do that here.',
  'error.common.not_found': 'That could not be found.',
  'error.common.validation_failed': 'Some details need correcting.',
  'error.common.state_conflict':
    'This changed while you were working. Reload the page and try again.',
  'error.common.rate_limited': 'Too many attempts. Wait a few minutes, then try again.',
  'error.common.internal': 'Something went wrong on our side. Try again in a moment.',
  'error.common.service_unavailable': 'This is not available right now. Try again later.',
  'error.validation.verification.reason_required': 'Write a reason for the decision.',
  'error.validation.moderation.reason_required':
    'Write a reason for the decision. On a rejection or a return, the customer reads it as written.',
  'error.validation.moderation.tags_on_publish':
    'Tags are confirmed only when a mission is published.',
  'error.validation.tags.unknown': 'One of these tags does not exist. Choose from the list.',
  'error.validation.tags.deprecated':
    'One of these tags is no longer in use. Choose a current one.',
  'error.validation.moderation.note_empty':
    'Leave the internal note empty, or write something in it.',
} as const;

export type MessageKey = keyof typeof en;

const PLURAL = /\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g;

/**
 * The string for a key, with its arguments filled. A key that does not exist is a type error, not
 * a raw key on screen. Plurals are English's two forms, `#` the number.
 */
export function t(key: MessageKey, values: Readonly<Record<string, string | number>> = {}): string {
  return en[key]
    .replace(PLURAL, (_, name: string, one: string, other: string) => {
      const n = Number(values[name]);
      return (n === 1 ? one : other).replace('#', String(n));
    })
    .replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? String(values[name]) : whole,
    );
}

/** Whether a key chosen elsewhere — an API's `messageKey` — has a string here. */
export const has = (key: string): key is MessageKey => key in en;
