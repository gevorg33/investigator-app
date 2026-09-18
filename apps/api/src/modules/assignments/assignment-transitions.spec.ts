import { describe, expect, it } from 'vitest';
import { STAFF_SCOPES } from '../../common/authz/scopes';
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  isTransitionAllowed,
  type AssignmentStatus,
  type TransitionAuthority,
} from './assignment-transitions';

/**
 * The matrix is generated from the map, so the illegal cases cannot be forgotten — they are
 * every triple nobody listed. Hand-written tests cover the moves someone thought of; these
 * cover the ones they did not.
 */
const ALL_AUTHORITIES: readonly TransitionAuthority[] = [
  'CUSTOMER',
  'INVESTIGATOR',
  'SYSTEM',
  ...STAFF_SCOPES.map((s) => `STAFF:${s}` as const),
];

const TERMINAL: readonly AssignmentStatus[] = ['COMPLETED', 'CANCELLED'];

describe('the assignment transition map', () => {
  it('covers every status, so a new one cannot be added without deciding its moves', () => {
    expect(Object.keys(ASSIGNMENT_TRANSITIONS).sort()).toEqual([...ASSIGNMENT_STATUSES].sort());
  });

  it('names only real statuses as destinations', () => {
    for (const from of ASSIGNMENT_STATUSES) {
      for (const to of Object.keys(ASSIGNMENT_TRANSITIONS[from])) {
        expect(ASSIGNMENT_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('never allows a status to move to itself', () => {
    for (const s of ASSIGNMENT_STATUSES) {
      expect(ASSIGNMENT_TRANSITIONS[s][s], `${s} -> ${s}`).toBeUndefined();
    }
  });

  it.each(TERMINAL)('leaves %s terminal', (status) => {
    expect(Object.keys(ASSIGNMENT_TRANSITIONS[status])).toEqual([]);
  });

  it('gives every move at least one authority', () => {
    for (const from of ASSIGNMENT_STATUSES) {
      for (const [to, who] of Object.entries(ASSIGNMENT_TRANSITIONS[from])) {
        expect(who, `${from} -> ${to}`).not.toHaveLength(0);
      }
    }
  });

  it('makes every status reachable except the one an assignment starts in', () => {
    const reachable = new Set(
      ASSIGNMENT_STATUSES.flatMap((from) => Object.keys(ASSIGNMENT_TRANSITIONS[from])),
    );
    for (const status of ASSIGNMENT_STATUSES) {
      if (status === 'PENDING_ACCEPTANCE') continue;
      expect([...reachable], `${status} unreachable`).toContain(status);
    }
  });

  it('starts where creation puts it, and creation is not a move', () => {
    // An assignment is created PENDING_ACCEPTANCE by a payment, not moved there from anywhere.
    const intoPending = ASSIGNMENT_STATUSES.filter(
      (from) => ASSIGNMENT_TRANSITIONS[from]['PENDING_ACCEPTANCE'] !== undefined,
    );
    expect(intoPending).toEqual([]);
  });
});

/**
 * Properties of the whole map, not of single edges — the form that survives someone adding a
 * transition later without reading this file.
 */
describe('who may do what', () => {
  it('lets only the investigator accept', () => {
    for (const from of ASSIGNMENT_STATUSES) {
      for (const by of ALL_AUTHORITIES) {
        if (!isTransitionAllowed(from, 'ACCEPTED', by)) continue;
        expect(from).toBe('PENDING_ACCEPTANCE');
        expect(by).toBe('INVESTIGATOR');
      }
    }
  });

  it('never lets the customer accept or deliver on the investigator’s behalf', () => {
    for (const from of ASSIGNMENT_STATUSES) {
      expect(isTransitionAllowed(from, 'ACCEPTED', 'CUSTOMER'), `${from}`).toBe(false);
      expect(isTransitionAllowed(from, 'REPORT_SUBMITTED', 'CUSTOMER'), `${from}`).toBe(false);
    }
  });

  it('lets only the customer complete the work', () => {
    // "When you submit your report and the customer accepts it."
    for (const from of ASSIGNMENT_STATUSES) {
      for (const by of ALL_AUTHORITIES) {
        if (!isTransitionAllowed(from, 'COMPLETED', by)) continue;
        expect(from).toBe('REPORT_SUBMITTED');
        expect(by).toBe('CUSTOMER');
      }
    }
  });

  it('allows a policy halt from both windows after acceptance, and never before', () => {
    // "Accepting does not trap you: if you discover the problem at hour twenty, you can stop."
    expect(isTransitionAllowed('ACCEPTED', 'SUSPENDED', 'INVESTIGATOR')).toBe(true);
    expect(isTransitionAllowed('IN_PROGRESS', 'SUSPENDED', 'INVESTIGATOR')).toBe(true);
    // Before accepting, the refusal is a decline, not a halt.
    expect(isTransitionAllowed('PENDING_ACCEPTANCE', 'SUSPENDED', 'INVESTIGATOR')).toBe(false);
    expect(isTransitionAllowed('PENDING_ACCEPTANCE', 'CANCELLED', 'INVESTIGATOR')).toBe(true);
  });

  it('lets only a moderator lift a suspension', () => {
    // The halt is reviewed by staff: "either the material is removed and you resume, or the
    // assignment is cancelled".
    expect(isTransitionAllowed('SUSPENDED', 'IN_PROGRESS', 'STAFF:MODERATION')).toBe(true);
    expect(isTransitionAllowed('SUSPENDED', 'IN_PROGRESS', 'INVESTIGATOR')).toBe(false);
    expect(isTransitionAllowed('SUSPENDED', 'IN_PROGRESS', 'CUSTOMER')).toBe(false);
  });

  it('refuses a staff scope other than the one the move names', () => {
    // A moderator is not a disputes reviewer.
    expect(isTransitionAllowed('SUSPENDED', 'IN_PROGRESS', 'STAFF:DISPUTES')).toBe(false);
    expect(isTransitionAllowed('ACCEPTED', 'CANCELLED', 'STAFF:DISPUTES')).toBe(true);
    expect(isTransitionAllowed('ACCEPTED', 'CANCELLED', 'STAFF:PAYMENTS')).toBe(false);
  });

  it('never lets the system move an assignment except to close an unanswered one', () => {
    // The acceptance window closing is the only thing the system decides on its own.
    for (const from of ASSIGNMENT_STATUSES) {
      for (const to of ASSIGNMENT_STATUSES) {
        if (!isTransitionAllowed(from, to, 'SYSTEM')) continue;
        expect(from).toBe('PENDING_ACCEPTANCE');
        expect(to).toBe('CANCELLED');
      }
    }
  });
});

/**
 * Every (from, to, authority) triple the map does not list, asserted refused. Seven statuses
 * and nine authorities make 441 triples; the handful that are legal are asserted legal, and
 * the rest are the test.
 */
describe('the generated legality matrix', () => {
  const cases = ASSIGNMENT_STATUSES.flatMap((from) =>
    ASSIGNMENT_STATUSES.flatMap((to) =>
      ALL_AUTHORITIES.map((by) => ({
        from,
        to,
        by,
        allowed: ASSIGNMENT_TRANSITIONS[from][to]?.includes(by) ?? false,
      })),
    ),
  );

  it('is not vacuous', () => {
    expect(cases.length).toBe(
      ASSIGNMENT_STATUSES.length * ASSIGNMENT_STATUSES.length * ALL_AUTHORITIES.length,
    );
    expect(cases.filter((c) => c.allowed).length).toBeGreaterThan(0);
  });

  it('refuses every triple the map does not list', () => {
    const wrong = cases.filter((c) => isTransitionAllowed(c.from, c.to, c.by) !== c.allowed);
    expect(wrong).toEqual([]);
  });
});
