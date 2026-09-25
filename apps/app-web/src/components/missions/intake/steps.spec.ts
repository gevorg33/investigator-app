import { describe, expect, it } from 'vitest';
import { ownMission } from '@/test/fixtures';
import { isStep, missing, resumeAt, STEPS, stepOf, today } from './steps';
import { EMPTY } from './use-draft';

describe('the intake’s steps', () => {
  it('ask one thing each, in the order a person thinks of them, and end with the brief', () => {
    expect(STEPS).toEqual([
      'need',
      'kind',
      'where',
      'when',
      'budget',
      'languages',
      'who',
      'why',
      'review',
    ]);
  });

  it('know every question the API can refuse a field for', () => {
    // The API's required fields (REQUIRED_AT_SUBMISSION) and the protective-order answer.
    expect(
      [
        'taxonomyNodeId',
        'title',
        'description',
        'countryCode',
        'deadline',
        'budgetMinMinor',
        'budgetMaxMinor',
        'currency',
        'purpose',
        'subjectRelationship',
        'languages',
        'protectiveOrderDeclared',
      ].map(stepOf),
    ).toEqual([
      'kind',
      'need',
      'need',
      'where',
      'when',
      'budget',
      'budget',
      'budget',
      'why',
      'who',
      'languages',
      'who',
    ]);
    expect(stepOf('location')).toBeUndefined();
  });

  it('list every required answer an empty draft lacks, and none of the optional ones', () => {
    expect(Object.fromEntries(STEPS.map((s) => [s, missing(s, EMPTY)]))).toEqual({
      need: ['title', 'description'],
      kind: ['taxonomyNodeId'],
      where: ['countryCode'],
      when: ['deadline'],
      budget: ['currency', 'budgetMinMinor', 'budgetMaxMinor'],
      languages: ['languages'],
      who: ['subjectRelationship'],
      why: ['purpose'],
      review: [],
    });
  });

  it('count words of spaces as no answer', () => {
    expect(missing('need', { ...EMPTY, title: '   ', description: 'x' })).toEqual(['title']);
    expect(missing('why', { ...EMPTY, purpose: ' \n ' })).toEqual(['purpose']);
  });

  it.each([
    ['FAMILY_MEMBER', null, ['protectiveOrderDeclared']],
    ['PARTNER_OR_SPOUSE', null, ['protectiveOrderDeclared']],
    ['FORMER_PARTNER', false, []],
    ['BUSINESS_RELATIONSHIP', null, []],
  ] as const)(
    'ask about a protective order where the relationship is %s and the answer is %s',
    (subjectRelationship, protectiveOrderDeclared, expected) => {
      expect(missing('who', { ...EMPTY, subjectRelationship, protectiveOrderDeclared })).toEqual(
        expected,
      );
    },
  );

  it('resume a draft at its first unanswered question, or at the brief when all are', () => {
    expect(resumeAt(EMPTY)).toBe('need');
    expect(resumeAt(ownMission({ currency: null }))).toBe('budget');
    expect(resumeAt(ownMission())).toBe('review');
  });

  it('recognise a step named in the address, and nothing else', () => {
    expect(isStep('budget')).toBe(true);
    expect(isStep('review')).toBe(true);
    expect(isStep('submit')).toBe(false);
    expect(isStep(undefined)).toBe(false);
  });

  it('give today as the reader’s own calendar day', () => {
    expect(today(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(today(new Date(2026, 10, 25))).toBe('2026-11-25');
  });
});
