import { describe, expect, it } from 'vitest';
import { STAFF_SCOPES, type StaffScope } from './index';

/**
 * `STAFF_SCOPES` is a runtime list of a compile-time union, and the two can drift: adding a
 * scope to the union and forgetting the array leaves a scope that type-checks everywhere and
 * appears in no staff console.
 *
 * The record below is what makes this a drift test rather than a restatement. It is typed
 * `Record<StaffScope, true>`, so a new union member fails to compile until it is added here,
 * and this assertion then fails until it is added to the array as well.
 */
const EVERY_SCOPE: Record<StaffScope, true> = {
  VERIFICATION: true,
  MODERATION: true,
  DISPUTES: true,
  PAYMENTS: true,
  TAXONOMY: true,
  ENFORCEMENT: true,
};

describe('STAFF_SCOPES', () => {
  it('lists every scope the union declares', () => {
    expect([...STAFF_SCOPES].sort()).toEqual(Object.keys(EVERY_SCOPE).sort());
  });

  it('lists each one once — a duplicate would double-count a scope in any tally', () => {
    expect(new Set(STAFF_SCOPES).size).toBe(STAFF_SCOPES.length);
  });
});
