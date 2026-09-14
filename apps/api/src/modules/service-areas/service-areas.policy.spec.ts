import { describe, expect, it } from 'vitest';
import { CENTRE_DECIMALS, coarsen, MIN_RADIUS_KM, toReportedKm } from './service-areas.policy';

describe('service area policy', () => {
  it('coarsens to two decimal places, about a kilometre', () => {
    expect(CENTRE_DECIMALS).toBe(2);
    expect(coarsen(44.51523)).toBe(44.52);
    expect(coarsen(40.18724)).toBe(40.19);
    expect(coarsen(-74.00612)).toBe(-74.01);
  });

  it('rounds reported distances up, so a result never understates how far away someone is', () => {
    expect([0, 1, 999, 1000, 1001, 15_400].map(toReportedKm)).toEqual([0, 1, 1, 1, 2, 16]);
  });

  it('keeps the minimum radius at 5 km, matching the database constraint', () => {
    expect(MIN_RADIUS_KM).toBe(5);
  });
});
