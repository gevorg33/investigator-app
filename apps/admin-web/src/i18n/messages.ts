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
