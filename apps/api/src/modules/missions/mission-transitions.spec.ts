import { describe, expect, it } from 'vitest';
import { STAFF_SCOPES } from '../../common/authz/scopes';
import {
  isTransitionAllowed,
  MISSION_STATUSES,
  MISSION_TRANSITIONS,
  type MissionStatus,
  type TransitionAuthority,
} from './mission-transitions';

/**
 * The matrix is generated from the map, so the illegal cases cannot be forgotten — they are
 * every pair nobody listed. Hand-written tests cover the moves someone thought of; these cover
 * the ones they did not.
 */
const ALL_AUTHORITIES: readonly TransitionAuthority[] = [
  'CUSTOMER',
  'INVESTIGATOR',
  'SYSTEM',
  ...STAFF_SCOPES.map((s) => `STAFF:${s}` as const),
];

const TERMINAL: readonly MissionStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'];

describe('the mission transition map', () => {
  it('covers every status, so a new status cannot be added without deciding its moves', () => {
    expect(Object.keys(MISSION_TRANSITIONS).sort()).toEqual([...MISSION_STATUSES].sort());
  });

  it('names only real statuses as destinations', () => {
    for (const from of MISSION_STATUSES) {
      for (const to of Object.keys(MISSION_TRANSITIONS[from])) {
        expect(MISSION_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('never allows a status to move to itself', () => {
    for (const s of MISSION_STATUSES)
      expect(MISSION_TRANSITIONS[s][s], `${s} -> ${s}`).toBeUndefined();
  });

  it.each(TERMINAL)('leaves %s terminal', (status) => {
    expect(Object.keys(MISSION_TRANSITIONS[status])).toEqual([]);
  });

  it('gives every move at least one authority', () => {
    for (const from of MISSION_STATUSES) {
      for (const [to, who] of Object.entries(MISSION_TRANSITIONS[from])) {
        expect(who, `${from} -> ${to}`).not.toHaveLength(0);
      }
    }
  });

  it('makes every status reachable except the one a mission starts in', () => {
    const reachable = new Set(
      MISSION_STATUSES.flatMap((from) => Object.keys(MISSION_TRANSITIONS[from])),
    );
    // DRAFT is reachable too — a moderator returning a mission for changes.
    for (const status of MISSION_STATUSES)
      expect([...reachable], `${status} unreachable`).toContain(status);
  });
});

/**
 * The publication gate, asserted as a property of the whole map rather than of one edge.
 *
 * "No mission reaches investigators without a moderator publishing it" (plan.md §10, T-051).
 * A future edit that adds any other way to QUOTED fails here.
 */
describe('publication is a moderator decision', () => {
  it('can only reach QUOTED from UNDER_REVIEW, and only by a moderator', () => {
    for (const from of MISSION_STATUSES) {
      for (const by of ALL_AUTHORITIES) {
        if (!isTransitionAllowed(from, 'QUOTED', by)) continue;
        expect(from).toBe('UNDER_REVIEW');
        expect(by).toBe('STAFF:MODERATION');
      }
    }
  });

  it('never lets the system publish or reject, whatever screening finds', () => {
    for (const from of MISSION_STATUSES) {
      expect(isTransitionAllowed(from, 'QUOTED', 'SYSTEM'), `${from} -> QUOTED`).toBe(false);
      expect(isTransitionAllowed(from, 'REJECTED', 'SYSTEM'), `${from} -> REJECTED`).toBe(false);
    }
  });

  it('only ever rejects from review, and only by a moderator', () => {
    for (const from of MISSION_STATUSES) {
      for (const by of ALL_AUTHORITIES) {
        if (!isTransitionAllowed(from, 'REJECTED', by)) continue;
        expect(from).toBe('UNDER_REVIEW');
        expect(by).toBe('STAFF:MODERATION');
      }
    }
  });

  it('routes a submission only into review', () => {
    expect(Object.keys(MISSION_TRANSITIONS.SUBMITTED)).toEqual(['UNDER_REVIEW']);
  });
});

/**
 * Every (from, to, authority) triple the map does not list, asserted refused. 17 statuses and
 * nine authorities make 2601 triples; the handful that are legal are asserted legal, and the
 * rest are the test.
 */
describe('the generated legality matrix', () => {
  const cases = MISSION_STATUSES.flatMap((from) =>
    MISSION_STATUSES.flatMap((to) =>
      ALL_AUTHORITIES.map((by) => {
        const allowed = MISSION_TRANSITIONS[from][to]?.includes(by) ?? false;
        return { from, to, by, allowed };
      }),
    ),
  );

  it('is not vacuous', () => {
    expect(cases.length).toBe(
      MISSION_STATUSES.length * MISSION_STATUSES.length * ALL_AUTHORITIES.length,
    );
    expect(cases.filter((c) => c.allowed).length).toBeGreaterThan(0);
  });

  it('refuses every triple the map does not list', () => {
    const wrong = cases.filter((c) => isTransitionAllowed(c.from, c.to, c.by) !== c.allowed);
    expect(wrong).toEqual([]);
  });

  it('refuses a staff scope other than the one the move names', () => {
    // A moderator is not a disputes reviewer: the scope is part of the authority, not decoration.
    expect(isTransitionAllowed('UNDER_REVIEW', 'QUOTED', 'STAFF:DISPUTES')).toBe(false);
    expect(isTransitionAllowed('UNDER_REVIEW', 'QUOTED', 'STAFF:MODERATION')).toBe(true);
    expect(isTransitionAllowed('DISPUTED', 'COMPLETED', 'STAFF:MODERATION')).toBe(false);
    expect(isTransitionAllowed('DISPUTED', 'COMPLETED', 'STAFF:DISPUTES')).toBe(true);
  });

  it('refuses a customer the moves that belong to staff or the system', () => {
    expect(isTransitionAllowed('UNDER_REVIEW', 'QUOTED', 'CUSTOMER')).toBe(false);
    expect(isTransitionAllowed('SUBMITTED', 'UNDER_REVIEW', 'CUSTOMER')).toBe(false);
    expect(isTransitionAllowed('CUSTOMER_CONFIRMED', 'PAID', 'CUSTOMER')).toBe(false);
  });
});
