import { catalogs } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage, { generateMetadata } from '@/app/(workspace)/missions/investigators/[id]/page';
import type { ProfileReviews as Reviews, PublicReview } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { account, ownProfile } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { NotFound } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { ProfileReviews } from './profile-reviews';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.missions.profile;
const ID = 'df7995b6-72b4-46e5-9e92-48b883daedb6';
const DD = '5f51f336-5c7a-442a-909f-8d54d5abf81b';

const review = (over: Partial<PublicReview> = {}): PublicReview => ({
  id: 'r-1',
  rating: 4,
  createdAt: '2026-09-20T10:00:00.000Z',
  text: 'Thorough, and the report was clear.',
  response: null,
  ...over,
});
const reviews = (
  items: PublicReview[],
  nextCursor: string | null = null,
  summary = { count: items.length, average: items.length === 0 ? null : 4.25 },
): Reviews => ({ summary, items, pageInfo: { nextCursor, hasNextPage: nextCursor !== null } });

/** The public projection only — what `GET /profiles/investigator/:id` returns. */
const PUBLIC = (() => {
  const { contactPhone, visibility, verificationStatus, ...rest } = ownProfile({ id: ID });
  void contactPhone;
  void visibility;
  void verificationStatus;
  return rest;
})();

beforeEach(() => {
  request.reset();
  api.install();
  api.on('GET /me', 200, account());
});

describe('an investigator’s public profile page', () => {
  const show = async (id = ID) => {
    renderIntl(await resolveServer(await ProfilePage({ params: Promise.resolve({ id }) })));
  };
  const serve = (profile: object = PUBLIC, list: Reviews = reviews([review()])) => {
    api.on(`GET /profiles/investigator/${ID}`, 200, profile);
    api.on(`GET /profiles/investigator/${ID}/reviews`, 200, list);
    api.on('GET /taxonomy?locale=en', 200, [
      { id: DD, label: 'Due diligence', slug: 'due-diligence', children: [] },
    ]);
    api.on('GET /blocks', 200, { items: [] });
  };

  it('shows the public projection under the name, once, and the way back', async () => {
    serve();
    await show();
    expect(screen.getByRole('heading', { level: 1, name: 'Ararat Lantern' })).toBeVisible();
    expect(screen.getAllByText('Ararat Lantern')).toHaveLength(1);
    const article = screen.getByRole('article');
    expect(article).toHaveTextContent(catalogs.en.investigator.verification_status.VERIFIED);
    expect(article).toHaveTextContent('Due diligence');
    expect(screen.getByRole('link', { name: en.back })).toHaveAttribute(
      'href',
      '/missions/investigators',
    );
    expect((await generateMetadata({ params: Promise.resolve({ id: ID }) })).title).toBe(
      'Ararat Lantern',
    );
  });

  it('names one who chose no pseudonym by their code, never otherwise, and works with no tree', async () => {
    api.on(`GET /profiles/investigator/${ID}`, 200, {
      ...PUBLIC,
      pseudonym: null,
      verified: false,
    });
    api.on(`GET /profiles/investigator/${ID}/reviews`, 200, reviews([]));
    api.on('GET /taxonomy?locale=en', 204);
    api.on('GET /blocks', 204);
    await show();
    // The stand-in is the code, in the reader's language — the legal name is never sent (T-181).
    const title = catalogs.en.investigator.public_name.unnamed.replace('{code}', 'K7Q2');
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeVisible();
    expect(screen.getByRole('article')).not.toHaveTextContent(
      catalogs.en.investigator.verification_status.VERIFIED,
    );
    // A specialty the reader's tree does not name is shown by its id rather than dropped.
    expect(screen.getByRole('article')).toHaveTextContent(DD);
    expect((await generateMetadata({ params: Promise.resolve({ id: ID }) })).title).toBe(title);
  });

  it('is not found for a profile the API will not show, nor for an address that is no id', async () => {
    api.on(
      `GET /profiles/investigator/${ID}`,
      404,
      apiError('NOT_FOUND', 'error.common.not_found'),
    );
    await expect(ProfilePage({ params: Promise.resolve({ id: ID }) })).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(
      ProfilePage({ params: Promise.resolve({ id: 'not-an-id' }) }),
    ).rejects.toBeInstanceOf(NotFound);
    const asked = api.calls.map((c) => c.path).filter((path) => path !== '/me');
    expect(asked).toEqual([`/profiles/investigator/${ID}`]);
  });

  it('shows an unconfirmed reader the profile, and what opens its reviews in their place (T-164)', async () => {
    serve();
    api.on('GET /me', 200, account({ emailVerified: false }));
    await show();
    expect(screen.getByRole('heading', { level: 1, name: 'Ararat Lantern' })).toBeVisible();
    const section = screen.getByRole('region', { name: en.reviews });
    const { confirm_first, profile } = catalogs.en.account;
    expect(within(section).getByRole('heading', { name: confirm_first.title })).toBeVisible();
    expect(within(section).getByRole('button', { name: profile.resend })).toBeVisible();
    expect(within(section).queryByRole('listitem')).toBeNull();
    // Not asked for: the API shows reviews to an active account only.
    expect(api.calls.map((c) => c.path)).not.toContain(`/profiles/investigator/${ID}/reviews`);
  });

  it('offers the reader a block, and once blocked says so with the way back (T-052)', async () => {
    serve();
    await show();
    const { block, blocks } = catalogs.en.account;
    expect(screen.getByRole('button', { name: block.action.investigator })).toBeVisible();

    api.on('GET /blocks', 200, {
      items: [
        {
          id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
          source: 'profile',
          label: 'Ararat Lantern',
          investigatorProfileId: ID,
          createdAt: '2026-09-30T08:00:00.000Z',
        },
      ],
    });
    document.body.innerHTML = '';
    await show();
    expect(screen.getByRole('status')).toHaveTextContent(block.blocked);
    expect(screen.getByRole('button', { name: blocks.unblock })).toBeVisible();
    expect(screen.queryByRole('button', { name: block.action.investigator })).toBeNull();
  });

  it('offers no block to a reader whose address is not confirmed, and does not ask', async () => {
    serve();
    api.on('GET /me', 200, account({ emailVerified: false }));
    await show();
    const { block } = catalogs.en.account;
    expect(screen.queryByRole('button', { name: block.action.investigator })).toBeNull();
    expect(api.calls.map((c) => c.path)).not.toContain('/blocks');
  });

  it('passes any other failure on', async () => {
    api.on(
      `GET /profiles/investigator/${ID}`,
      500,
      apiError('INTERNAL_ERROR', 'error.common.internal'),
    );
    await expect(ProfilePage({ params: Promise.resolve({ id: ID }) })).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('an investigator’s reviews', () => {
  const list = (initial: Reviews, locale: 'en' | 'ru' = 'en') =>
    renderIntl(<ProfileReviews profileId={ID} initial={initial} />, locale);

  it('sums them up, then shows each: stars in words, when, the words, the reply — never who', () => {
    list(
      reviews(
        [
          review({ response: 'Thank you.' }),
          review({ id: 'r-2', rating: 5, text: null, createdAt: '2026-09-10T10:00:00.000Z' }),
        ],
        null,
        { count: 12, average: 4.25 },
      ),
    );
    const section = screen.getByRole('region', { name: en.reviews });
    expect(section).toHaveTextContent('4.3 out of 5 · 12 reviews');
    const [first, second] = within(section).getAllByRole('listitem');
    expect(within(first!).getByRole('img', { name: '4 out of 5' })).toBeVisible();
    expect(first).toHaveTextContent('Sep 20, 2026');
    expect(first).toHaveTextContent('Thorough, and the report was clear.');
    expect(first).toHaveTextContent(en.by);
    expect(first).toHaveTextContent(`${en.response}Thank you.`);
    expect(within(second!).getByRole('img', { name: '5 out of 5' })).toBeVisible();
    expect(second!.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: en.more })).toBeNull();
  });

  it('says there are none', () => {
    list(reviews([]));
    expect(screen.getByText(en.none)).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('reads one review in the reader’s language', () => {
    list(reviews([review({ rating: 1 })], null, { count: 1, average: 1 }), 'ru');
    expect(screen.getByRole('region')).toHaveTextContent('1 из 5 · 1 отзыв');
    expect(screen.getByRole('img', { name: '1 из 5' })).toBeVisible();
  });

  it('shows more on request, then no more', async () => {
    api.on(
      `GET /profiles/investigator/${ID}/reviews?cursor=c%2F2`,
      200,
      reviews([review({ id: 'r-3', text: 'Second page.' })]),
    );
    list(reviews([review()], 'c/2', { count: 2, average: 4 }));
    await userEvent.setup().click(screen.getByRole('button', { name: en.more }));
    expect(await screen.findByText('Second page.')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: en.more })).toBeNull();
  });

  it('says why more could not be read, keeping what is shown', async () => {
    api.on(
      `GET /profiles/investigator/${ID}/reviews?cursor=c-2`,
      400,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
    );
    list(reviews([review()], 'c-2'));
    const more = screen.getByRole('button', { name: en.more });
    await userEvent.setup().click(more);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.common.validation_failed,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(more).toBeEnabled();

    api.down(`GET /profiles/investigator/${ID}/reviews?cursor=c-2`);
    await userEvent.setup().click(more);
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
  });
});
