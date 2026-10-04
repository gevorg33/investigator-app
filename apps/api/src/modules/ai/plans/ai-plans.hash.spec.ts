import { describe, expect, it } from 'vitest';
import { canonicalJson, digestObservation, planHash, type HashedStep } from './plan-hash';

/** The hash a confirmation is bound to (T-048): the same plan always, a different one never. */
describe('the plan hash', () => {
  const step = (over: Partial<HashedStep> = {}): HashedStep => ({
    ordinal: 1,
    tool: 'addToTally',
    arguments: { name: 'rent', amount: 2 },
    observed: 'a'.repeat(64),
    ...over,
  });
  const plan = (steps: HashedStep[], over: { id?: string; sessionId?: string } = {}) =>
    planHash({ id: 'p1', sessionId: 's1', steps, ...over });

  it('writes JSON with its keys in one order at every depth, leaving out what is undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: null }, z: undefined })).toBe(
      '{"a":{"c":null,"d":[3,{"e":2,"f":1}]},"b":1}',
    );
    expect(canonicalJson([undefined, 'x'])).toBe('[null,"x"]');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson('quoted "text"')).toBe('"quoted \\"text\\""');
  });

  it('is the same however the steps and their arguments arrive', () => {
    const one = step({ arguments: { name: 'rent', amount: 2 } });
    const same = step({ arguments: { amount: 2, name: 'rent' } });
    const two = step({ ordinal: 2, tool: 'addToTally' });
    expect(plan([one, two])).toBe(plan([two, same]));
    expect(plan([one])).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['another plan id', [step()], { id: 'p2' }],
    ['another session', [step()], { sessionId: 's2' }],
    ['another tool', [step({ tool: 'addToTallies' })], {}],
    ['another argument', [step({ arguments: { name: 'rent', amount: 3 } })], {}],
    ['an extra argument', [step({ arguments: { name: 'rent', amount: 2, note: 'x' } })], {}],
    ['another observed state', [step({ observed: 'b'.repeat(64) })], {}],
    ['another order', [step({ ordinal: 2 })], {}],
    ['another step', [step(), step({ ordinal: 2 })], {}],
  ] as const)('changes with %s', (_what, steps, over) => {
    expect(plan([...steps], over)).not.toBe(plan([step()]));
  });

  it('digests an observation by value, and nothing as null', () => {
    expect(digestObservation({ v: 1, name: 'x' })).toBe(digestObservation({ name: 'x', v: 1 }));
    expect(digestObservation({ v: 1 })).not.toBe(digestObservation({ v: 2 }));
    expect(digestObservation(undefined)).toBe(digestObservation(null));
  });
});
