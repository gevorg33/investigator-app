import { catalogs } from '@investigator/i18n';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscoveryPage, { generateMetadata } from '@/app/(workspace)/missions/investigators/page';
import type { InvestigatorSearchResult } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { account, ownProfile } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import {
  discoveryHref,
  narrowingCount,
  parseDiscovery,
  searchBody,
  type DiscoveryFilters,
} from './discovery-query';
import { InvestigatorDiscovery } from './investigator-discovery';
import { actsAsInvestigator, MissionsViews } from './missions-views';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.missions.discovery;
const DD = '5f51f336-5c7a-442a-909f-8d54d5abf81b';
const RECORDS = '6033b823-2a6d-4073-bc7b-f59ad3a5c2fd';
const CATEGORIES = [
  { id: 'corp', label: 'Corporate', depth: 0 },
  { id: DD, label: 'Due diligence', depth: 1 },
  { id: 'deep', label: 'Supplier checks', depth: 2 },
  { id: RECORDS, label: 'Records research', depth: 0 },
];
const COUNTRIES = [
  { code: 'AM', name: 'Armenia' },
  { code: 'GE', name: 'Georgia' },
];
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hy', name: 'Armenian' },
  { code: 'ru', name: 'Russian' },
];

const result = (over: Partial<InvestigatorSearchResult> = {}): InvestigatorSearchResult => ({
  ...ownProfile(),
  id: 'p-1',
  distanceKm: null,
  matchedOn: { taxonomyNodeIds: [], languages: [], place: null, availability: false },
  notMatched: { taxonomyNodeIds: [] },
  ...over,
});
const page = (items: InvestigatorSearchResult[], nextCursor: string | null = null) => ({
  items,
  pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
});
const SEARCH = 'POST /search/investigators';
const bodies = () => api.calls.filter((c) => c.path === '/search/investigators').map((c) => c.body);

const discovery = (filters: DiscoveryFilters = {}, locale: 'en' | 'ru' = 'en') =>
  renderIntl(
    <InvestigatorDiscovery
      filters={filters}
      categories={CATEGORIES}
      countries={COUNTRIES}
      languages={LANGUAGES}
      locale={locale}
    />,
    locale,
  );
const user = () => userEvent.setup();

/** The device's answer to "where am I": a position, a refusal (1) or failure (2), or none yet. */
const device = (answer: [number, number] | 1 | 2 | null) => {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail: PositionErrorCallback) => {
    if (answer === null) return;
    if (typeof answer === 'number') {
      fail({ code: answer, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    } else {
      ok({ coords: { longitude: answer[0], latitude: answer[1] } } as GeolocationPosition);
    }
  });
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
};

beforeEach(() => {
  request.reset();
  api.install();
  router.reset();
});

describe('a search in the address', () => {
  it('keeps only filters the API would take, and writes them back the same way', () => {
    const filters = parseDiscovery({
      country: ' am ',
      city: 'Yerevan',
      category: DD,
      language: ['hy', 'en', 'hy', 'english', ''],
      day: '2',
      pricing: 'HOURLY',
    });
    expect(filters).toEqual({
      countryCode: 'AM',
      city: 'Yerevan',
      taxonomyNodeId: DD,
      languages: ['hy', 'en'],
      day: 2,
      pricingModel: 'HOURLY',
    });
    expect(discoveryHref(filters)).toBe(
      `/missions/investigators?category=${DD}&language=hy&language=en&country=AM&city=Yerevan&day=2&pricing=HOURLY`,
    );
    expect(narrowingCount(filters)).toBe(7);
  });

  it('drops what is malformed, and has nowhere to put a location', () => {
    const filters = parseDiscovery({
      country: 'Armenia',
      category: 'not-a-uuid',
      day: '7',
      pricing: 'FREE',
      language: Array.from({ length: 25 }, (_, i) => String.fromCharCode(97 + (i % 26)) + 'a'),
      near: '44.5,40.1',
    });
    expect(filters.languages).toHaveLength(20);
    expect(Object.keys(filters)).toEqual(['languages']);
    expect(parseDiscovery({ city: ['  ', 'x'] })).toEqual({});
    // One value arrives as a string, not a list.
    expect(parseDiscovery({ language: 'hy' })).toEqual({ languages: ['hy'] });
    expect(discoveryHref({})).toBe('/missions/investigators');
    expect(narrowingCount({})).toBe(0);
  });

  it('asks the API for exactly the filters, the location only when shared, and any part of a day', () => {
    expect(searchBody({}, null, null)).toEqual({});
    expect(
      searchBody(
        {
          taxonomyNodeId: DD,
          languages: ['hy'],
          day: 0,
          countryCode: 'AM',
          city: 'Gyumri',
          pricingModel: 'RETAINER',
        },
        { centre: { lon: 44.51, lat: 40.18 }, radiusKm: 25 },
        'c-2',
      ),
    ).toEqual({
      countryCode: 'AM',
      city: 'Gyumri',
      taxonomyNodeIds: [DD],
      languages: ['hy'],
      availableDuring: { dayOfWeek: 0, startMinute: 0, endMinute: 1440 },
      pricingModel: 'RETAINER',
      near: { lon: 44.51, lat: 40.18 },
      radiusKm: 25,
      cursor: 'c-2',
    });
  });
});

describe('finding investigators', () => {
  it('lists verified investigators, each saying why it was listed and only why', async () => {
    api.on(
      SEARCH,
      200,
      page([
        result({
          matchedOn: {
            taxonomyNodeIds: [DD, 'retired'],
            languages: ['hy'],
            place: { countryCode: 'AM', city: 'Yerevan' },
            availability: true,
          },
          notMatched: { taxonomyNodeIds: [RECORDS, 'gone'] },
          languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
        }),
      ]),
    );
    discovery({ taxonomyNodeId: DD });
    const card = await screen.findByRole('article', { name: 'Ani Petrosyan' });
    expect(card).toHaveTextContent(en.card.verified);
    expect(card).toHaveTextContent('Corporate due diligence in the Caucasus');
    expect(card).toHaveTextContent(
      'Matches Due diligence, Armenian, Yerevan, Armenia, and available that day',
    );
    expect(card).toHaveTextContent('Does not offer Records research');
    expect(card).toHaveTextContent('Armenian · 10 years of experience · By the hour, AMD');
    expect(within(card).getByRole('link', { name: 'Ani Petrosyan' })).toHaveAttribute(
      'href',
      '/missions/investigators/p-1',
    );
    expect(
      within(card).getByRole('link', { name: `${en.card.view}: Ani Petrosyan` }),
    ).toBeVisible();
    expect(bodies()).toEqual([{ taxonomyNodeIds: [DD] }]);
  });

  it('says nothing it was not told: no match line, no distance, no pricing, no name', async () => {
    api.on(
      SEARCH,
      200,
      page([
        result({
          displayName: null,
          verified: false,
          headline: null,
          yearsExperience: null,
          pricingModel: null,
          languages: [],
        }),
        result({ id: 'p-2', pricingModel: 'FIXED_FEE', hourlyRateMinor: null }),
      ]),
    );
    discovery();
    const [bare, fixed] = await screen.findAllByRole('article');
    expect(bare).toHaveAccessibleName(catalogs.en.investigator.details.not_set);
    expect(bare).not.toHaveTextContent(en.card.verified);
    expect(bare).not.toHaveTextContent('Matches');
    expect(bare!.querySelectorAll('p')).toHaveLength(1);
    expect(fixed).toHaveTextContent('A fixed fee');
    expect(fixed).not.toHaveTextContent('an hour');
  });

  it('shows the list loading, then more on request, in order', async () => {
    const release = api.hold(SEARCH, 200, page([result()], 'c-2'));
    discovery();
    expect(screen.getByRole('status', { name: en.loading })).toBeInTheDocument();
    await act(async () => release());
    await screen.findByRole('article');
    api.on(SEARCH, 200, page([result({ id: 'p-2', displayName: 'Davit' })]));
    await user().click(screen.getByRole('button', { name: en.more }));
    expect(await screen.findByRole('article', { name: 'Davit' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(bodies()[1]).toEqual({ cursor: 'c-2' });
    expect(screen.queryByRole('button', { name: en.more })).toBeNull();
  });

  it('says why a search failed, and keeps what it had when "more" fails', async () => {
    api.on(SEARCH, 422, apiError('VALIDATION_FAILED', 'error.common.validation_failed'));
    const { unmount } = discovery();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.common.validation_failed,
    );
    unmount();
    api.on(SEARCH, 200, page([result()], 'c-2'));
    discovery();
    await screen.findByRole('article');
    api.down(SEARCH);
    await user().click(screen.getByRole('button', { name: en.more }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('says so when nobody is listed at all, rather than blaming the filters', async () => {
    api.on(SEARCH, 200, page([]));
    discovery();
    expect(await screen.findByRole('heading', { name: en.none_title })).toBeVisible();
    expect(screen.getByText(en.none_body)).toBeVisible();
  });

  it('suggests widening, not a dead end: each filter removes itself, or all at once', async () => {
    api.on(SEARCH, 200, page([]));
    discovery({
      taxonomyNodeId: DD,
      languages: ['hy', 'en'],
      countryCode: 'AM',
      city: 'Gyumri',
      day: 4,
      pricingModel: 'HOURLY',
    });
    expect(await screen.findByRole('heading', { name: en.empty_title })).toBeVisible();
    expect(screen.getByText(en.empty_body)).toBeVisible();
    const chips = screen
      .getAllByRole('link', { name: /^Remove / })
      .map((a) => [a.textContent, a.getAttribute('href')]);
    const base = '/missions/investigators?';
    expect(chips).toEqual([
      [
        'Due diligence',
        `${base}language=hy&language=en&country=AM&city=Gyumri&day=4&pricing=HOURLY`,
      ],
      ['Armenian', `${base}category=${DD}&language=en&country=AM&city=Gyumri&day=4&pricing=HOURLY`],
      ['English', `${base}category=${DD}&language=hy&country=AM&city=Gyumri&day=4&pricing=HOURLY`],
      ['Armenia', `${base}category=${DD}&language=hy&language=en&city=Gyumri&day=4&pricing=HOURLY`],
      ['Gyumri', `${base}category=${DD}&language=hy&language=en&country=AM&day=4&pricing=HOURLY`],
      [
        'Available Friday',
        `${base}category=${DD}&language=hy&language=en&country=AM&city=Gyumri&pricing=HOURLY`,
      ],
      ['By the hour', `${base}category=${DD}&language=hy&language=en&country=AM&city=Gyumri&day=4`],
    ]);
    expect(screen.getByRole('link', { name: en.clear })).toHaveAttribute(
      'href',
      '/missions/investigators',
    );
  });

  it('names a filter it has no label for by what it is', async () => {
    api.on(SEARCH, 200, page([]));
    discovery({ taxonomyNodeId: 'retired-node', languages: ['xx'], countryCode: 'ZZ' });
    await screen.findByRole('heading', { name: en.empty_title });
    expect(screen.getAllByRole('link', { name: /^Remove / }).map((a) => a.textContent)).toEqual([
      en.category,
      'xx',
      'ZZ',
    ]);
    // Removing the last language removes the filter, not an empty list of them.
    expect(screen.getByRole('link', { name: 'Remove xx' })).toHaveAttribute(
      'href',
      '/missions/investigators?category=retired-node&country=ZZ',
    );
  });

  describe('near me', () => {
    it('searches around the device’s rounded position, never putting it in the address', async () => {
      device([44.514_98, 40.182_37]);
      api.on(SEARCH, 200, page([result({ distanceKm: 0 })]));
      discovery({ languages: ['hy'] });
      await screen.findByRole('article');
      await user().click(screen.getByRole('button', { name: en.near }));
      expect(await screen.findByText(en.card.covers)).toBeVisible();
      expect(bodies().at(-1)).toEqual({
        languages: ['hy'],
        near: { lon: 44.51, lat: 40.18 },
        radiusKm: 0,
      });
      expect(screen.getByText(en.near_on)).toBeVisible();
      expect(router.push).not.toHaveBeenCalled();

      const radius = screen.getByRole('group', { name: en.radius });
      expect(within(radius).getByRole('radio', { name: en.radius_covers })).toBeChecked();
      api.on(SEARCH, 200, page([result({ distanceKm: 12 })]));
      await user().click(within(radius).getByRole('radio', { name: '25 km' }));
      // Tapping the chosen distance again leaves it chosen: there is always one.
      await user().click(within(radius).getByRole('radio', { name: '25 km' }));
      expect(await screen.findByText('12 km away')).toBeVisible();
      expect(bodies().at(-1)).toMatchObject({ radiusKm: 25 });

      api.on(SEARCH, 200, page([result()]));
      await user().click(screen.getByRole('button', { name: en.near_off }));
      await vi.waitFor(() => expect(bodies().at(-1)).toEqual({ languages: ['hy'] }));
      expect(screen.queryByRole('group', { name: en.radius })).toBeNull();
    });

    it('offers to look further when nobody covers the location', async () => {
      device([43.85, 40.79]);
      api.on(SEARCH, 200, page([]));
      discovery();
      await screen.findByRole('heading', { name: en.none_title });
      await user().click(screen.getByRole('button', { name: en.near }));
      // A location narrows the search: now it is the filters' fault, not an empty platform.
      expect(await screen.findByRole('heading', { name: en.empty_title })).toBeVisible();
      api.on(SEARCH, 200, page([result({ distanceKm: 73 })]));
      await user().click(screen.getByRole('button', { name: 'Search up to 100 km away' }));
      expect(await screen.findByText('73 km away')).toBeVisible();
      expect(bodies().at(-1)).toMatchObject({ radiusKm: 100 });
      expect(screen.queryByRole('button', { name: /^Search up to/ })).toBeNull();
    });

    it.each([
      [1, en.denied],
      [2, en.failed],
    ] as const)('says what to do when the device answers error %i', async (code, words) => {
      device(code);
      api.on(SEARCH, 200, page([result()]));
      discovery();
      await screen.findByRole('article');
      await user().click(screen.getByRole('button', { name: en.near }));
      expect(screen.getByRole('alert')).toHaveTextContent(words);
      expect(bodies()).toHaveLength(1);
    });

    it('shows it is looking while the device has not answered', async () => {
      device(null);
      api.on(SEARCH, 200, page([result()]));
      discovery();
      await screen.findByRole('article');
      await user().click(screen.getByRole('button', { name: en.near }));
      const button = screen.getByRole('button', { name: en.locating });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
    });
  });

  it('drops the answer to a search a newer one replaced', async () => {
    device([44.51, 40.18]);
    const release = api.hold(SEARCH, 200, page([result({ displayName: 'Stale' })]));
    discovery();
    api.on(SEARCH, 200, page([result({ displayName: 'Fresh', distanceKm: 0 })]));
    await user().click(screen.getByRole('button', { name: en.near }));
    expect(await screen.findByRole('article', { name: 'Fresh' })).toBeVisible();
    await act(async () => release());
    expect(screen.queryByRole('article', { name: 'Stale' })).toBeNull();
  });

  it('drops the error of a search a newer one replaced', async () => {
    device([44.51, 40.18]);
    let fail!: () => void;
    api.routes.set(
      SEARCH,
      () => new Promise((_, reject) => (fail = () => reject(new TypeError('x')))),
    );
    discovery();
    api.on(SEARCH, 200, page([result({ displayName: 'Fresh', distanceKm: 0 })]));
    await user().click(screen.getByRole('button', { name: en.near }));
    await screen.findByRole('article', { name: 'Fresh' });
    await act(async () => fail());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the filter sheet', () => {
  const open = async () => {
    await user().click(screen.getByRole('button', { name: /^Filters/ }));
    return screen.findByRole('dialog', { name: en.filters });
  };

  it('counts what is on, and applies the choices as the address', async () => {
    api.on(SEARCH, 200, page([]));
    discovery({ languages: ['en'] });
    expect(screen.getByLabelText('1 filter on')).toBeInTheDocument();
    const sheet = await open();
    const u = user();
    await u.type(within(sheet).getByRole('combobox', { name: en.category_search }), 'supp');
    await u.click(within(sheet).getByRole('option', { name: 'Supplier checks' }));
    await u.selectOptions(within(sheet).getByRole('combobox', { name: en.language_add }), 'hy');
    await u.click(within(sheet).getByRole('button', { name: 'Remove English' }));
    await u.selectOptions(within(sheet).getByRole('combobox', { name: en.country }), 'GE');
    await u.type(within(sheet).getByRole('textbox', { name: en.city }), '  Tbilisi ');
    await u.click(within(sheet).getByRole('radio', { name: 'Wednesday' }));
    // Tapping the chosen day again keeps it chosen.
    await u.click(within(sheet).getByRole('radio', { name: 'Wednesday' }));
    await u.click(within(sheet).getByRole('radio', { name: 'A retainer' }));
    await u.click(within(sheet).getByRole('button', { name: en.show }));
    expect(router.push).toHaveBeenCalledWith(
      '/missions/investigators?category=deep&language=hy&country=GE&city=Tbilisi&day=2&pricing=RETAINER',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears choices one at a time or all at once, and "any" means none', async () => {
    api.on(SEARCH, 200, page([]));
    discovery({
      taxonomyNodeId: DD,
      languages: ['hy'],
      countryCode: 'AM',
      city: 'Yerevan',
      day: 1,
      pricingModel: 'HOURLY',
    });
    const sheet = await open();
    const u = user();
    await u.click(within(sheet).getByRole('option', { name: en.category_any }));
    await u.click(within(sheet).getByRole('button', { name: 'Remove Armenian' }));
    await u.selectOptions(within(sheet).getByRole('combobox', { name: en.country }), '');
    await u.clear(within(sheet).getByRole('textbox', { name: en.city }));
    await u.click(within(sheet).getByRole('radio', { name: en.day_any }));
    await u.click(within(sheet).getByRole('radio', { name: en.pricing_any }));
    // Tapping the chosen chip again keeps it: there is always one.
    await u.click(within(sheet).getByRole('radio', { name: en.pricing_any }));
    await u.click(within(sheet).getByRole('button', { name: en.show }));
    expect(router.push).toHaveBeenLastCalledWith('/missions/investigators');

    const again = await open();
    await u.click(within(again).getByRole('option', { name: 'Due diligence' }));
    await u.click(within(again).getByRole('button', { name: en.reset }));
    expect(within(again).getByRole('textbox', { name: en.city })).toHaveValue('');
    await u.click(within(again).getByRole('button', { name: en.show }));
    expect(router.push).toHaveBeenLastCalledWith('/missions/investigators');
  });

  it('finds no specialty for words that name none, and closes without applying', async () => {
    api.on(SEARCH, 200, page([]));
    discovery();
    const sheet = await open();
    await user().type(within(sheet).getByRole('combobox', { name: en.category_search }), 'zzz');
    expect(within(sheet).getByText(en.category_none)).toBeVisible();
    await user().click(within(sheet).getByRole('button', { name: en.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('a customer’s views of Missions', () => {
  it('are their missions and finding investigators, the current one marked', async () => {
    renderIntl(await resolveServer(await MissionsViews({ current: 'find' })));
    const nav = screen.getByRole('navigation', { name: catalogs.en.missions.views.label });
    const links = within(nav).getAllByRole('link');
    expect(
      links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]),
    ).toEqual([
      [catalogs.en.missions.views.mine, '/missions', null],
      [catalogs.en.missions.views.find, '/missions/investigators', 'page'],
    ]);
  });

  it.each([
    [null, false],
    [account({ roles: ['CUSTOMER'] }), false],
    [account({ roles: ['CUSTOMER', 'INVESTIGATOR'], activeRole: 'CUSTOMER' }), false],
    [account({ roles: ['CUSTOMER', 'INVESTIGATOR'] }), true],
    [account({ roles: ['INVESTIGATOR'] }), true],
  ])(
    'are the customer’s side unless the reader works as an investigator (%#)',
    (who, investigator) => {
      expect(actsAsInvestigator(who)).toBe(investigator);
    },
  );
});

describe('the find-investigators page', () => {
  it('searches with the address’s filters, from the tree, countries and languages in the reader’s language', async () => {
    request.cookies.set('locale', 'ru');
    api.on('GET /me', 200, account({ roles: ['CUSTOMER'] }));
    api.on('GET /taxonomy?locale=ru', 200, [
      { id: 'corp', label: null, slug: 'corporate', children: [] },
    ]);
    api.on(SEARCH, 200, page([]));
    renderIntl(
      await resolveServer(
        await DiscoveryPage({ searchParams: Promise.resolve({ country: 'AM', category: 'x' }) }),
      ),
      'ru',
    );
    const ru = catalogs.ru.missions;
    expect(screen.getByRole('link', { name: ru.views.find })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await screen.findByRole('heading', { name: ru.discovery.empty_title });
    expect(bodies()).toEqual([{ countryCode: 'AM' }]);
    expect(
      screen.getByRole('link', { name: `${ru.discovery.remove.replace('{filter}', 'Армения')}` }),
    ).toBeVisible();
    expect((await generateMetadata()).title).toBe(ru.discovery.title);
  });

  it('works with no tree at all', async () => {
    api.on('GET /me', 200, account({ roles: ['CUSTOMER'] }));
    api.on('GET /taxonomy?locale=en', 204);
    api.on(SEARCH, 200, page([]));
    renderIntl(await resolveServer(await DiscoveryPage({ searchParams: Promise.resolve({}) })));
    expect(await screen.findByRole('heading', { name: en.none_title })).toBeVisible();
  });

  it('sends someone working as an investigator back to Missions', async () => {
    api.on('GET /me', 200, account({ roles: ['INVESTIGATOR'] }));
    await expect(DiscoveryPage({ searchParams: Promise.resolve({}) })).rejects.toEqual(
      new Redirected('/missions'),
    );
  });
});
