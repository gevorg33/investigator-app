import type { FieldIssue } from '../../common/errors/app-error';

/** Field limits, mirrored by CHECK constraints in migration 0007. */
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 5000;
export const PURPOSE_MAX = 2000;
export const LOCATION_LABEL_MAX = 120;
export const CANCEL_REASON_MAX = 500;
export const MAX_LANGUAGES = 10;
/** Comfortably inside a 32-bit integer, so a budget can never overflow the column. */
export const BUDGET_MAX_MINOR = 2_000_000_000;

/**
 * True only for a real calendar day. `2026-02-31` matches the shape of a date and is not one;
 * left to the database it raises a driver error, which reaches the customer as a 500 rather
 * than as the field error it is.
 *
 * The check builds the date and reads it back, because `Date.parse` is not the test it looks
 * like: it accepted `2026-02-31` here and rolled it forward to 3 March, so the invalid date
 * reached the database — which a test caught by getting a 500 where it wanted a 422.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const built = new Date(Date.UTC(year, month - 1, day));
  // A rolled-over date comes back as a different day than the one asked for.
  return (
    built.getUTCFullYear() === year &&
    built.getUTCMonth() === month - 1 &&
    built.getUTCDate() === day
  );
}

/** The draft's free-text fields: each may be absent (`null`), never present and empty. */
const TEXT_FIELDS = ['title', 'description', 'purpose', 'locationLabel'] as const;

type DraftShape = {
  title?: string | null;
  description?: string | null;
  purpose?: string | null;
  locationLabel?: string | null;
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  startBy?: string | null;
  deadline?: string | null;
};

/**
 * The rules `missions_text_lengths`, `missions_budget_range` and `missions_timeline_order`
 * enforce, checked first so each reaches the client as the field error it is rather than as a
 * 500 (T-153). The constraints stay as the last line.
 *
 * `patch` is what the request sends; `merged` is the draft as it would be stored. Text is
 * judged on the patch alone — a stored value already passed the constraint — and the pairs on
 * the merged draft, because a request may move one end of a range past the other end it did not
 * send.
 */
export function draftIssues(patch: DraftShape, merged: DraftShape): FieldIssue[] {
  const issues: FieldIssue[] = TEXT_FIELDS.filter((f) => patch[f] === '').map((field) => ({
    field,
    code: 'BLANK',
    messageKey: 'error.validation.mission.blank',
  }));
  const { budgetMinMinor: min, budgetMaxMinor: max, startBy, deadline } = merged;
  if (min != null && max != null && min > max) {
    issues.push({
      field: 'budgetMaxMinor',
      code: 'RANGE',
      messageKey: 'error.validation.budget.range',
    });
  }
  // ISO dates order as strings.
  if (startBy != null && deadline != null && startBy > deadline) {
    issues.push({
      field: 'deadline',
      code: 'RANGE',
      messageKey: 'error.validation.deadline.range',
    });
  }
  return issues;
}
