import { describe, expect, it } from 'vitest';
import { customerAliasOf } from './customer-alias';

const ONE = '0b6f3c1e-8f4a-4a52-9d1e-1a2b3c4d5e6f';
const TWO = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('the customer alias (T-100)', () => {
  it('is four characters a person can read back: Crockford base 32, no I, L, O or U', () => {
    for (const id of [ONE, TWO]) expect(customerAliasOf(id)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('is the same for everyone who sees a mission, every time', () => {
    expect(customerAliasOf(ONE)).toBe(customerAliasOf(ONE));
  });

  it('cannot link two missions: it is made from the mission alone, and differs between them', () => {
    // The function takes nothing else — no customer id to share between two of their missions.
    expect(customerAliasOf.length).toBe(1);
    expect(customerAliasOf(ONE)).not.toBe(customerAliasOf(TWO));
  });

  it('is not the mission id, or any part of it, read off', () => {
    for (const id of [ONE, TWO]) {
      expect(id.toUpperCase().replaceAll('-', '')).not.toContain(customerAliasOf(id));
    }
  });
});
