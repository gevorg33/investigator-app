import { catalogs, type Locale } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { listing } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import type { SearchParams } from './browse-query';
import { MissionBrowse } from './mission-browse';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.missions.browse;
const NODE = '6033b823-2a6d-4073-bc7b-f59ad3a5c2fd';
const AREA = '73bfea12-d346-4940-8012-e78e1a5ea9cc';
const DD = '5f51f336-5c7a-442a-909f-8d54d5abf81b';
const PAGE = (items = [listing()], nextCursor: string | null = null) => ({
  items,
  pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
});

/** The investigator's own context: a tree, an area, their languages, their saved searches. */
const context = (
  locale: Locale = 'en',
  opts: { areas?: unknown[]; languages?: string[]; saved?: unknown[] } = {},
) => {
  api.on(`GET /taxonomy?locale=${locale}`, 200, [
    {
      id: NODE,
      label: 'Corporate',
      slug: 'corporate',
      children: [
        { id: DD, label: 'Due diligence', slug: 'due-diligence', children: [] },
        {
          id: 'node-x',
          label: null,
          slug: 'unlabelled',
          children: [{ id: 'node-y', label: 'Deep', slug: 'deep', children: [] }],
        },
      ],
    },
  ]);
  api.on('GET /service-areas/me', 200, opts.areas ?? [{ id: AREA, label: 'Yerevan' }]);
  api.on('GET /profiles/investigator/me', 200, {
    languages: (opts.languages ?? ['en', 'hy']).map((languageCode) => ({ languageCode })),
  });
  api.on('GET /search/missions/saved', 200, { items: opts.saved ?? [] });
};

const show = async (params: SearchParams = {}, locale: Locale = 'en') =>
  renderIntl(await resolveServer(await MissionBrowse({ params, locale })), locale);
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
const body = () => api.calls.find((c) => c.path === '/search/missions')!.body;

describe('open missions', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    router.reset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  describe('a mission card', () => {
    it('leads with what it is, and ends with what decides a quote', async () => {
      api.on('POST /search/missions', 200, PAGE([listing({ distanceKm: 0 })]));
      context();
      await show({ sort: 'closest' });
      const card = screen.getByRole('article', {
        name: 'Supplier background before a distribution deal',
      });
      expect(card).toHaveTextContent('Due diligence');
      expect(card).toHaveTextContent('Posted 2 hours ago');
      expect(card).toHaveTextContent(`Yerevan, Kentron · ${en.card.inside}`);
      expect(card).toHaveTextContent('In Armenian and English');
      expect(card).toHaveTextContent('BudgetAMD 200,000–450,000');
      expect(card).toHaveTextContent('Due Oct 16, 2026');
      expect(body()).toEqual({ sort: 'closest' });
    });

    it.each([
      ['2026-09-25', 'Due today'],
      ['2026-09-26', 'Due tomorrow'],
      ['2026-10-02', 'Due in 7 days'],
      // Past its date and still published: said as today, never as a negative count.
      ['2026-09-20', 'Due today'],
    ])('flags a deadline of %s in words as well as colour', async (deadline, words) => {
      api.on('POST /search/missions', 200, PAGE([listing({ deadline })]));
      context();
      await show();
      const badge = within(screen.getByRole('article')).getByText(words);
      expect(badge.closest('[data-slot=badge]')).toHaveAttribute('data-variant', 'warning');
    });

    it('says how far, when asked; nothing of a category it cannot name; no place it does not know', async () => {
      api.on(
        'POST /search/missions',
        200,
        PAGE([
          listing({ id: 'm-1', distanceKm: 55, locationLabel: null, taxonomyNodeId: 'retired' }),
          listing({ id: 'm-2', locationLabel: null }),
        ]),
      );
      context();
      await show();
      const [far, nowhere] = screen.getAllByRole('article');
      expect(far).toHaveTextContent('55 km from your area');
      expect(far!.querySelector('[data-slot=badge][data-variant=secondary]')).toBeNull();
      expect(nowhere!.querySelectorAll('li')).toHaveLength(1);
    });
  });

  describe('the controls', () => {
    it('search the words given, which then set the order themselves', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ language: 'hy', sort: 'deadline' });
      const u = user();
      await u.type(screen.getByRole('searchbox', { name: en.search }), '  court records {Enter}');
      expect(router.push).toHaveBeenCalledWith(
        // The order is the words' own, so the address carries no other.
        '/missions?q=court+records&language=hy',
      );
    });

    it('keep the chosen order when searching for nothing', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ sort: 'deadline' });
      await user().type(screen.getByRole('searchbox', { name: en.search }), '{Enter}');
      expect(router.push).toHaveBeenCalledWith('/missions?sort=deadline');
    });

    it('go back to the chosen order when the words are cleared', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ q: 'court', language: 'hy' });
      expect(body()).toEqual({ languages: ['hy'], q: 'court', sort: 'relevance' });
      // With words, the order is theirs: the control says so instead of offering a choice.
      expect(screen.queryByRole('combobox', { name: en.sort })).toBeNull();
      expect(screen.getByText(en.sort_relevance)).toBeInTheDocument();
      const u = user();
      await u.clear(screen.getByRole('searchbox', { name: en.search }));
      await u.type(screen.getByRole('searchbox', { name: en.search }), '{Enter}');
      expect(router.push).toHaveBeenCalledWith('/missions?language=hy');
    });

    it('change the order in place, offering closest only with an area to measure from', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      const { unmount } = await show({ language: 'hy' });
      const sort = screen.getByRole('combobox', { name: en.sort });
      expect(sort).toHaveValue('newest');
      await user().selectOptions(sort, 'budget');
      expect(router.push).toHaveBeenCalledWith('/missions?language=hy&sort=budget');
      unmount();

      context('en', { areas: [] });
      await show();
      const values = [
        ...screen.getByRole('combobox', { name: en.sort }).querySelectorAll('option'),
      ].map((o) => o.getAttribute('value'));
      expect(values).toEqual(['newest', 'budget', 'deadline']);
    });
  });

  describe('the filter sheet', () => {
    const open = async (u = user()) => {
      await u.click(screen.getByRole('button', { name: new RegExp(en.filters) }));
      return screen.getByRole('dialog', { name: en.filters });
    };

    it('shows what is applied, and turns every choice into the address at once', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ language: 'hy' });
      expect(screen.getByRole('button', { name: /Filters/ })).toContainElement(
        screen.getByLabelText('1 filter on'),
      );
      const u = user();
      const sheet = await open(u);
      expect(within(sheet).getByText(en.sheet_body)).toBeInTheDocument();

      // Categories are searchable, indented under their parents, the applied one marked.
      await u.type(within(sheet).getByRole('combobox', { name: en.category_search }), 'dilig');
      await u.click(within(sheet).getByRole('option', { name: 'Due diligence' }));
      // Chips for languages (several), posted (one) and distance (one).
      expect(within(sheet).getByRole('button', { name: 'Armenian', pressed: true })).toBeVisible();
      await u.click(within(sheet).getByRole('button', { name: 'English' }));
      await u.click(within(sheet).getByRole('radio', { name: 'In the last 7 days' }));
      await u.click(within(sheet).getByRole('radio', { name: 'Within 25 km' }));
      await u.selectOptions(within(sheet).getByRole('combobox', { name: en.area }), AREA);
      await u.selectOptions(within(sheet).getByRole('combobox', { name: en.currency }), 'AMD');
      await u.type(within(sheet).getByRole('textbox', { name: en.budget_min }), '1500');
      await u.type(within(sheet).getByRole('textbox', { name: en.budget_max }), '2000.5');
      await u.click(within(sheet).getByRole('button', { name: en.show }));

      expect(router.push).toHaveBeenCalledWith(
        `/missions?category=${DD}&language=hy&language=en&currency=AMD&min=1500&max=2000.5` +
          `&area=${AREA}&within=25&posted=7`,
      );
    });

    it('takes a choice back: any category, any time, any distance, no languages, no amounts', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({
        category: DD,
        language: 'hy',
        posted: '7',
        within: '25',
        currency: 'AMD',
        min: '5',
      });
      const u = user();
      const sheet = await open(u);
      expect(within(sheet).getByRole('textbox', { name: en.budget_min })).toHaveValue('5');
      await u.click(within(sheet).getByRole('option', { name: en.category_any }));
      await u.click(within(sheet).getByRole('button', { name: 'Armenian' }));
      await u.click(within(sheet).getByRole('radio', { name: en.posted_any }));
      await u.click(within(sheet).getByRole('radio', { name: en.within_any }));
      await u.selectOptions(within(sheet).getByRole('combobox', { name: en.currency }), '');
      await u.selectOptions(within(sheet).getByRole('combobox', { name: en.area }), '');
      await u.clear(within(sheet).getByRole('textbox', { name: en.budget_min }));
      await u.click(within(sheet).getByRole('button', { name: en.show }));
      expect(router.push).toHaveBeenCalledWith('/missions');
    });

    it('resets to the whole list when there are no words and no order to keep', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ language: 'hy' });
      const u = user();
      const sheet = await open(u);
      await u.click(within(sheet).getByRole('button', { name: en.reset }));
      expect(router.push).toHaveBeenCalledWith('/missions');
    });

    it('resets what narrows, and keeps the words and the order', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ q: 'court', category: DD, due: '2026-10-31' });
      const u = user();
      const sheet = await open(u);
      expect(within(sheet).getByLabelText(en.due_by)).toHaveValue('2026-10-31');
      await u.click(within(sheet).getByRole('button', { name: en.reset }));
      expect(router.push).toHaveBeenCalledWith('/missions?q=court');
    });

    it('offers nothing it cannot use: no language chips or distances without them', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context('en', { areas: [], languages: [] });
      await show({ sort: 'deadline' });
      const u = user();
      const sheet = await open(u);
      expect(within(sheet).queryByRole('group', { name: en.languages })).toBeNull();
      expect(within(sheet).queryByRole('combobox', { name: en.area })).toBeNull();
      await u.type(within(sheet).getByRole('combobox', { name: en.category_search }), 'zzz');
      expect(within(sheet).getByText(en.category_none)).toBeInTheDocument();
      await u.click(within(sheet).getByRole('button', { name: en.reset }));
      expect(router.push).toHaveBeenCalledWith('/missions?sort=deadline');
    });

    it('opens from the side on a wide screen', async () => {
      const wide = vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList);
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show();
      const sheet = await open();
      expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'right');
      wide.mockRestore();
    });
  });

  describe('the filters that are on', () => {
    it('are chips that each remove themselves, and one that removes them all', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({
        q: 'court',
        category: DD,
        language: ['hy', 'en'],
        currency: 'AMD',
        min: '1500',
        max: '2000',
        due: '2026-10-31',
        posted: '7',
        area: AREA,
        within: '0',
      });
      const chips = screen.getByRole('list', { name: en.filters });
      const links = within(chips).getAllByRole('link');
      // Intl puts a non-breaking space between a currency code and its amount.
      expect(
        links.map((a) => [(a.getAttribute('aria-label') ?? a.textContent!).replace(/\s/g, ' ')]),
      ).toEqual([
        ['Remove filter: Due diligence'],
        ['Remove filter: Armenian'],
        ['Remove filter: English'],
        ['Remove filter: AMD 1,500–2,000'],
        ['Remove filter: Due by Oct 31, 2026'],
        ['Remove filter: In the last 7 days'],
        ['Remove filter: Yerevan'],
        ['Remove filter: Inside the area'],
        [en.clear],
      ]);
      expect(links[1]).toHaveAttribute('href', expect.stringContaining('language=en&currency=AMD'));
      expect(links[2]).toHaveAttribute('href', expect.stringContaining('language=hy&currency'));
      expect(links.at(-1)).toHaveAttribute('href', '/missions?q=court');
    });

    it.each([
      [{ currency: 'AMD', min: '1500' }, /^Remove filter: AMD\s1,500 or more$/],
      [{ currency: 'AMD', max: '1500' }, /^Remove filter: Up to AMD\s1,500$/],
      [{ currency: 'AMD' }, /^Remove filter: AMD$/],
    ])('say a budget in words (%o)', async (params, name) => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show(params);
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    });

    it('take the budget order with the budget, and fall back on labels they cannot resolve', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context('en', { areas: [] });
      await show({
        currency: 'AMD',
        sort: 'budget',
        category: 'b0a1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d',
        area: AREA,
        within: '10',
      });
      expect(screen.getByRole('link', { name: 'Remove filter: AMD' })).toHaveAttribute(
        'href',
        '/missions?category=b0a1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d&area=73bfea12-d346-4940-8012-e78e1a5ea9cc&within=10',
      );
      expect(screen.getByRole('link', { name: `Remove filter: ${en.category}` })).toBeVisible();
      expect(screen.getByRole('link', { name: `Remove filter: ${en.area}` })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Remove filter: Within 10 km' })).toBeVisible();
      expect(screen.getByRole('link', { name: en.clear })).toHaveAttribute('href', '/missions');
    });

    it('are nothing when nothing narrows the list', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ q: 'court' });
      expect(screen.queryByRole('list', { name: en.filters })).toBeNull();
    });
  });

  describe('pages and states', () => {
    it('pages with the cursor it was given, and leads back to the first page', async () => {
      api.on('POST /search/missions', 200, PAGE([listing()], 'page-3'));
      context();
      await show({ category: NODE, currency: 'AMD', min: '1500', cursor: 'page-2' });
      expect(body()).toEqual({
        taxonomyNodeIds: [NODE],
        currency: 'AMD',
        budgetMinMinor: 150_000,
        cursor: 'page-2',
      });
      expect(screen.getByRole('link', { name: en.next })).toHaveAttribute(
        'href',
        `/missions?category=${NODE}&currency=AMD&min=1500&cursor=page-3`,
      );
      expect(screen.getByRole('link', { name: en.first })).toHaveAttribute(
        'href',
        `/missions?category=${NODE}&currency=AMD&min=1500`,
      );
    });

    it('says there is no work yet, or that the filters found none — which are different things', async () => {
      api.on('POST /search/missions', 200, PAGE([]));
      context();
      const { unmount } = await show();
      expect(screen.getByRole('heading', { name: en.none.title })).toBeInTheDocument();
      expect(screen.queryByRole('navigation')).toBeNull();
      unmount();
      await show({ currency: 'AMD' });
      expect(screen.getByRole('heading', { name: en.empty.title })).toBeInTheDocument();
    });

    it('says what opens browsing to an investigator who cannot quote yet', async () => {
      request.cookies.set('locale', 'ru');
      api.on('POST /search/missions', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      await show({}, 'ru');
      const ru = catalogs.ru.missions.browse;
      expect(screen.getByRole('heading', { name: ru.unavailable.title })).toBeInTheDocument();
      // What opens browsing is all on the profile page.
      expect(screen.getByRole('link', { name: catalogs.ru.investigator.link })).toHaveAttribute(
        'href',
        '/account/investigator',
      );
      expect(api.calls.map((c) => c.path)).toEqual(['/search/missions']);
    });

    it('says which filter to change when the API refuses one', async () => {
      api.on(
        'POST /search/missions',
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
          details: [
            {
              field: 'currency',
              code: 'REQUIRED',
              messageKey: 'error.validation.currency.required',
            },
          ],
        }),
      );
      context();
      await show({ min: '100' });
      expect(screen.getByRole('alert')).toHaveTextContent(
        catalogs.en.error.common.validation_failed,
      );
      expect(screen.getByText(catalogs.en.error.validation.currency.required)).toBeInTheDocument();
      expect(screen.queryByRole('article')).toBeNull();
      expect(screen.queryByRole('button', { name: en.saved.save_open })).toBeNull();
    });

    it('lets any other failure be the error it is', async () => {
      api.on('POST /search/missions', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await expect(MissionBrowse({ params: {}, locale: 'en' })).rejects.toMatchObject({
        status: 500,
      });
      api.down('POST /search/missions');
      await expect(MissionBrowse({ params: {}, locale: 'en' })).rejects.toThrow('Failed to fetch');
    });

    it('keeps going when the API has nothing to say about the investigator’s context', async () => {
      api.on('POST /search/missions', 204);
      api.on('GET /taxonomy?locale=en', 204);
      api.on('GET /service-areas/me', 204);
      api.on('GET /profiles/investigator/me', 204);
      api.on('GET /search/missions/saved', 204);
      await show();
      expect(screen.getByRole('heading', { name: en.none.title })).toBeInTheDocument();
    });
  });

  describe('saved searches', () => {
    const saved = [
      {
        id: 's-1',
        name: 'Armenian work',
        filters: { languages: ['hy'], sort: 'deadline' },
        createdAt: '2026-09-25T09:00:00Z',
      },
    ];

    it('are chips that run a search again from the first page', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context('en', { saved });
      await show();
      const region = screen.getByRole('region', { name: en.saved.title });
      expect(within(region).getByRole('link', { name: 'Armenian work' })).toHaveAttribute(
        'href',
        '/missions?language=hy&sort=deadline',
      );
    });

    it('save the browse on screen under a name — the filters, never the page', async () => {
      api.on('POST /search/missions', 200, PAGE());
      api.on('POST /search/missions/saved', 201, { id: 's-2' });
      context();
      await show({ language: 'hy', sort: 'newest', cursor: 'page-2' });
      const u = user();
      await u.click(screen.getByRole('button', { name: en.saved.save_open }));
      await u.type(screen.getByRole('textbox', { name: en.saved.name }), 'Armenian work');
      await u.click(screen.getByRole('button', { name: en.saved.save }));
      expect(api.calls.at(-1)).toMatchObject({
        method: 'POST',
        path: '/search/missions/saved',
        body: { name: 'Armenian work', filters: { languages: ['hy'], sort: 'newest' } },
      });
      expect(router.refresh).toHaveBeenCalled();
      // Saved, the form folds back into its button.
      expect(screen.getByRole('button', { name: en.saved.save_open })).toBeInTheDocument();
    });

    it('put a refused name on the name field, anything else above the form, and cancel cleanly', async () => {
      api.on('POST /search/missions', 200, PAGE());
      context();
      await show({ language: 'hy' });
      const u = user();
      await u.click(screen.getByRole('button', { name: en.saved.save_open }));
      const name = screen.getByRole('textbox', { name: en.saved.name });
      expect(name).toHaveFocus();

      api.on(
        'POST /search/missions/saved',
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
          details: [
            {
              field: 'name',
              code: 'TAKEN',
              messageKey: 'error.validation.saved_search.name_taken',
            },
          ],
        }),
      );
      await u.type(name, 'Same');
      await u.click(screen.getByRole('button', { name: en.saved.save }));
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(name).toHaveAccessibleDescription(
        catalogs.en.error.validation.saved_search.name_taken,
      );
      expect(screen.queryByRole('alert')).toBeNull();

      api.on(
        'POST /search/missions/saved',
        429,
        apiError('RATE_LIMITED', 'error.common.rate_limited'),
      );
      await u.click(screen.getByRole('button', { name: en.saved.save }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        catalogs.en.error.common.rate_limited,
      );

      await u.click(screen.getByRole('button', { name: en.saved.cancel }));
      expect(screen.queryByRole('textbox', { name: en.saved.name })).toBeNull();
      await u.click(screen.getByRole('button', { name: en.saved.save_open }));
      // Reopened, the old refusal is gone.
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('delete one, named for assistive technology', async () => {
      api.on('POST /search/missions', 200, PAGE());
      api.on('DELETE /search/missions/saved/s-1', 204);
      context('en', { saved });
      await show();
      await user().click(screen.getByRole('button', { name: 'Delete Armenian work' }));
      expect(api.calls.at(-1)).toMatchObject({
        method: 'DELETE',
        path: '/search/missions/saved/s-1',
      });
      expect(router.refresh).toHaveBeenCalled();
    });

    it('say so when one could not be deleted', async () => {
      api.on('POST /search/missions', 200, PAGE());
      api.on(
        'DELETE /search/missions/saved/s-1',
        404,
        apiError('NOT_FOUND', 'error.common.not_found'),
      );
      context('en', { saved });
      await show();
      await user().click(screen.getByRole('button', { name: 'Delete Armenian work' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        catalogs.en.error.common.not_found,
      );
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });
});
