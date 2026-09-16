import { describe, expect, it } from 'vitest';
import { isCalendarDate } from './missions.policy';

/**
 * The regression this file exists for: `Date.parse('2026-02-31')` does not return NaN. It
 * rolls the date forward to 3 March and reports success, so the first version of this check
 * passed an impossible date through to the database — where it became a 500 instead of the
 * field error a customer can act on.
 */
describe('isCalendarDate', () => {
  it.each(['2026-09-14', '2024-02-29', '2026-12-31', '2026-01-01'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each([
    ['a day February does not have', '2026-02-31'],
    ['29 February in a common year', '2026-02-29'],
    ['31 April', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-09-00'],
    ['day 32', '2026-09-32'],
  ])('refuses %s', (_label, value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it.each([
    ['a different separator', '2026/09/14'],
    ['a day-first format', '14-09-2026'],
    ['a timestamp', '2026-09-14T10:00:00Z'],
    ['a two-digit year', '26-09-14'],
    ['an unpadded month', '2026-9-14'],
    ['empty', ''],
    ['nonsense', 'tomorrow'],
  ])('refuses %s', (_label, value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});
