import { describe, expect, it } from 'vitest';
import { browseHref, minorDigits, narrowingCount, parseBrowse, toWhole } from './browse-query';

const NODE = '6033b823-2a6d-4073-bc7b-f59ad3a5c2fd';
const AREA = '73bfea12-d346-4940-8012-e78e1a5ea9cc';

describe('a browse in the address bar', () => {
  it('reads every filter, in the API’s shape, with amounts in minor units', () => {
    expect(
      parseBrowse({
        category: NODE,
        language: ['hy', 'en'],
        currency: 'amd',
        min: '1500',
        max: '2500,5',
        due: '2026-12-31',
        area: AREA,
        within: '25',
        posted: '7',
        sort: 'deadline',
        cursor: 'abc',
      }),
    ).toEqual({
      filters: {
        taxonomyNodeIds: [NODE],
        languages: ['hy', 'en'],
        currency: 'AMD',
        budgetMinMinor: 150_000,
        budgetMaxMinor: 250_050,
        deadlineTo: '2026-12-31',
        serviceAreaId: AREA,
        withinKm: 25,
        postedWithinDays: 7,
        sort: 'deadline',
      },
      cursor: 'abc',
    });
  });

  it('drops whatever is not the right shape — anyone can write a URL', () => {
    expect(
      parseBrowse({
        category: 'not-a-node',
        language: ['english', ''],
        currency: 'dollars',
        min: '-5',
        max: '1e9',
        due: '31/12/2026',
        area: 'x',
        within: '13',
        posted: '2',
        sort: 'cheapest',
        cursor: 'x'.repeat(513),
      }),
    ).toEqual({ filters: {} });
    // An amount past what the column holds is not an amount.
    expect(parseBrowse({ currency: 'USD', min: '99999999999' }).filters).toEqual({
      currency: 'USD',
    });
    // Empty fields from a submitted form are simply absent.
    expect(parseBrowse({ q: '', min: '', sort: '' }).filters).toEqual({});
  });

  it('orders by the words to look for whenever there are some, whatever else was chosen', () => {
    expect(parseBrowse({ q: '  court records ', sort: 'budget' }).filters).toEqual({
      q: 'court records',
      sort: 'relevance',
    });
    expect(parseBrowse({ q: 'x'.repeat(300) }).filters.q).toHaveLength(200);
  });

  it('takes the first of a repeated single value', () => {
    expect(parseBrowse({ category: [NODE, AREA], sort: ['closest', 'newest'] }).filters).toEqual({
      taxonomyNodeIds: [NODE],
      sort: 'closest',
    });
  });

  it('writes the address back, so a saved search or the next page runs the same browse', () => {
    const { filters } = parseBrowse({
      q: 'court',
      category: NODE,
      language: ['hy', 'ru'],
      currency: 'JPY',
      min: '5000',
      max: '9000',
      due: '2026-12-31',
      area: AREA,
      within: '0',
      posted: '30',
    });
    const href = browseHref(filters, 'next-page');
    expect(href).toBe(
      `/missions?q=court&category=${NODE}&language=hy&language=ru&currency=JPY&min=5000&max=9000` +
        `&due=2026-12-31&area=${AREA}&within=0&posted=30&cursor=next-page`,
    );
    expect(
      parseBrowse(Object.fromEntries(new URL(href, 'https://x.test').searchParams)).filters,
    ).toMatchObject({ currency: 'JPY', budgetMinMinor: 5000, budgetMaxMinor: 9000 });
    expect(browseHref({ sort: 'budget', currency: 'AMD' })).toBe(
      '/missions?currency=AMD&sort=budget',
    );
    expect(browseHref({})).toBe('/missions');
  });

  it('never uses `lang`, which the middleware takes as the whole app’s language (ADR-0013)', () => {
    expect(browseHref({ languages: ['hy', 'en'] })).toBe('/missions?language=hy&language=en');
    expect(parseBrowse({ lang: 'hy' }).filters).toEqual({});
  });

  it('counts only what narrows the list — not the order, not the words', () => {
    expect(narrowingCount({ q: 'x', sort: 'relevance' })).toBe(0);
    expect(narrowingCount({ currency: 'AMD', budgetMinMinor: 1, languages: ['hy'] })).toBe(3);
  });
});

describe('minor units', () => {
  it('come from the currency, and default to two', () => {
    expect(minorDigits('AMD')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits(undefined)).toBe(2);
    expect(minorDigits('1X')).toBe(2);
    expect(toWhole(150_050, 'USD')).toBe('1500.5');
    expect(toWhole(5000, 'JPY')).toBe('5000');
  });
});
