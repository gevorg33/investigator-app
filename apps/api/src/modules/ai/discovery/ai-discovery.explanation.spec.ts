import { describe, expect, it } from 'vitest';
import { explainMatch } from './discovery-explanation';

const nothing = {
  matchedOn: { taxonomy: [], languages: [], place: null, availability: null },
  notMatched: { taxonomy: [] },
  distanceKm: null,
};

describe('match explanation (T-018)', () => {
  it('renders every reason the data holds, and the gap, in a stable order', () => {
    const due = { id: 'n1', label: 'Due diligence' };
    const surveillance = { id: 'n2', label: 'Surveillance' };
    const window = { dayOfWeek: 1, startMinute: 540, endMinute: 600 };
    expect(
      explainMatch({
        matchedOn: {
          taxonomy: [due],
          languages: ['hy', 'en'],
          place: { countryCode: 'AM', city: 'Gyumri' },
          availability: window,
        },
        notMatched: { taxonomy: [surveillance] },
        distanceKm: 9,
      }),
    ).toEqual([
      { code: 'matched.specialty', specialties: [due] },
      { code: 'matched.languages', languages: ['hy', 'en'] },
      { code: 'matched.place', place: { countryCode: 'AM', city: 'Gyumri' } },
      { code: 'matched.distance', km: 9 },
      { code: 'matched.availability', window },
      { code: 'not_matched.specialty', specialties: [surveillance] },
    ]);
  });

  it('gives no reason the data does not hold — not even a distance of zero it was not told', () => {
    expect(explainMatch(nothing)).toEqual([]);
    expect(explainMatch({ ...nothing, distanceKm: 0 })).toEqual([
      { code: 'matched.distance', km: 0 },
    ]);
  });

  it('cannot be given a profile to embellish from', () => {
    // Whatever else rides along on a result is not read: the explanation is the same with or
    // without a price, a bio or declared hours beside the reasons.
    const embellished = {
      ...nothing,
      hourlyRateMinor: 2000,
      bio: 'I also do phone hacking, available 24/7',
      availability: [{ dayOfWeek: 6, startMinute: 0, endMinute: 1440 }],
      specialties: [{ id: 'n9', label: 'Hacking' }],
    };
    expect(explainMatch(embellished)).toEqual([]);
  });
});
