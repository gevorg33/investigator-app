import { catalogs } from '@investigator/i18n';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnMissions } from '@/components/missions/own-missions';
import type { OwnMission } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { account, ownMission } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { NotFound, Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import MissionPage, { generateMetadata as missionMeta } from './[id]/page';
import MissionLoading from './[id]/loading';
import NewMissionPage, { generateMetadata as newMeta } from './new/page';
import NewMissionLoading from './new/loading';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const en = catalogs.en.missions;
const ID = 'b7d3f0c2-5a61-4c1e-9f0a-3e2d1c4b5a69';
const DD = '5f51f336-5c7a-442a-909f-8d54d5abf81b';
const TAXONOMY = [
  {
    id: 'corp',
    label: 'Corporate',
    slug: 'corporate',
    children: [{ id: DD, label: 'Due diligence', slug: 'due-diligence', children: [] }],
  },
];
const DECIDED = '2026-09-24T10:00:00.000Z';

/** The reader, the taxonomy, and this mission as the API answers for it. */
const context = (mission?: Partial<OwnMission>) => {
  api.on('GET /me', 200, account({ timezone: 'Asia/Yerevan' }));
  api.on('GET /taxonomy?locale=en', 200, TAXONOMY);
  if (mission !== undefined) api.on(`GET /missions/me/${ID}`, 200, ownMission(mission));
};

const show = async (step?: string) =>
  renderIntl(
    await resolveServer(
      await MissionPage({
        params: Promise.resolve({ id: ID }),
        searchParams: Promise.resolve(step === undefined ? {} : { step }),
      }),
    ),
  );

describe('the mission pages', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    router.reset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  describe('a new mission', () => {
    it('opens the intake for a customer, creating nothing', async () => {
      context();
      renderIntl(
        await resolveServer(
          await NewMissionPage({ searchParams: Promise.resolve({ step: 'budget' }) }),
        ),
      );
      expect(screen.getByRole('heading', { level: 1, name: en.own.new })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        en.intake.budget.question,
      );
      expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'GET /me',
        'GET /taxonomy?locale=en',
      ]);
      expect((await newMeta()).title).toBe(en.own.new);
    });

    it('says a mission cannot be sent yet when there is no taxonomy at all', async () => {
      api.on('GET /me', 200, account());
      api.on('GET /taxonomy?locale=en', 204);
      renderIntl(
        await resolveServer(
          await NewMissionPage({ searchParams: Promise.resolve({ step: 'kind' }) }),
        ),
      );
      expect(screen.getByText(en.intake.kind.unavailable)).toBeInTheDocument();
    });

    it('ignores a step the address makes up', async () => {
      context();
      renderIntl(
        await resolveServer(await NewMissionPage({ searchParams: Promise.resolve({ step: 'x' }) })),
      );
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(en.intake.need.question);
    });

    it.each([
      ['someone signed in without the customer role', account({ roles: ['INVESTIGATOR'] })],
      ['no one', null],
    ])('sends %s to Missions', async (_, who) => {
      if (who === null) api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'x'));
      else api.on('GET /me', 200, who);
      await expect(NewMissionPage({ searchParams: Promise.resolve({}) })).rejects.toEqual(
        new Redirected('/missions'),
      );
    });
  });

  describe('a draft', () => {
    it('opens the intake where it stands, titled by the draft', async () => {
      context({ currency: null });
      await show();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Check a supplier before we sign' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        en.intake.budget.question,
      );
      expect((await missionMeta({ params: Promise.resolve({ id: ID }) })).title).toBe(
        'Check a supplier before we sign',
      );
    });

    it('opens at the step the address names, and calls an untitled draft that', async () => {
      context({ title: null });
      await show('where');
      expect(screen.getByRole('heading', { level: 1, name: en.own.untitled })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(en.intake.where.question);
      expect((await missionMeta({ params: Promise.resolve({ id: ID }) })).title).toBe(
        en.own.untitled,
      );
    });
  });

  describe('a sent mission', () => {
    it('says a person is reading it, when it was sent, and shows the brief as sent', async () => {
      context({ status: 'UNDER_REVIEW', submittedAt: '2026-09-24T21:30:00.000Z' });
      await show('budget');
      expect(screen.getByText(en.status.UNDER_REVIEW)).toBeInTheDocument();
      // Dated in the reader's own time zone: 21:30 UTC is already the 25th in Yerevan.
      expect(screen.getByText('Sent Sep 25, 2026')).toBeInTheDocument();
      expect(screen.getByText(en.view.review.title)).toBeInTheDocument();
      const brief = screen.getByRole('region', { name: en.view.brief });
      expect(brief).toHaveTextContent('Due diligence');
      expect(brief).toHaveTextContent('Armenia');
      expect(brief).toHaveTextContent('Armenian, English');
      expect(within(brief).queryByRole('button')).toBeNull();
      // No questions for a mission that can no longer be edited, whatever the address says.
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it.each([
      ['QUOTED', en.view.published.title],
      ['CANCELLED', en.view.cancelled.title],
    ] as const)('explains a %s mission', async (status, title) => {
      context({ status, submittedAt: '2026-09-24T09:00:00.000Z' });
      await show();
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    it('offers to withdraw a mission under review, and nothing past it (T-154)', async () => {
      context({ status: 'UNDER_REVIEW', submittedAt: '2026-09-24T09:00:00.000Z', version: 4 });
      const { unmount } = await show();
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await u.click(screen.getByRole('button', { name: en.cancel.action }));
      expect(screen.getByRole('alertdialog', { name: en.cancel.review.title })).toBeVisible();
      unmount();

      for (const status of ['QUOTED', 'CANCELLED', 'REJECTED', 'IN_PROGRESS'] as const) {
        api.install();
        context({ status, submittedAt: '2026-09-24T09:00:00.000Z' });
        const shown = await show();
        expect(screen.queryByRole('button', { name: en.cancel.action })).toBeNull();
        shown.unmount();
      }
    });

    it('shows only where it stands, when there is nothing more to explain', async () => {
      context({
        status: 'IN_PROGRESS',
        submittedAt: null,
        taxonomyNodeId: 'retired',
        countryCode: null,
        languages: ['xx'],
      });
      await show();
      expect(screen.getByText(en.status.IN_PROGRESS)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelector('[data-slot=alert]')).toBeNull();
      const brief = screen.getByRole('region', { name: en.view.brief });
      expect(brief).toHaveTextContent('xx');
    });

    it('gives the reviewer’s reason for a rejection, and the way on', async () => {
      context({
        status: 'REJECTED',
        submittedAt: DECIDED,
        review: {
          outcome: 'REJECTED',
          reason: 'Tracking a person is not supported.',
          decidedAt: DECIDED,
        },
      });
      await show();
      const rejected = screen.getByRole('region', { name: en.view.rejected.title });
      expect(rejected).toHaveTextContent(en.view.rejected.reason);
      expect(rejected).toHaveTextContent('Tracking a person is not supported.');
      expect(rejected).toHaveTextContent(en.view.rejected.next);
      expect(within(rejected).getByRole('link', { name: en.intake.review.policy })).toHaveAttribute(
        'href',
        '/help/kb-policy-prohibited-requests',
      );
    });

    it('says the reviewer gave no reason, rather than showing nothing', async () => {
      context({ status: 'REJECTED', submittedAt: DECIDED, review: null });
      await show();
      expect(screen.getByText(en.view.rejected.no_reason)).toBeInTheDocument();
    });

    it('starts a new draft from a rejected one, at the brief, without the confirmation', async () => {
      context({
        status: 'REJECTED',
        submittedAt: DECIDED,
        lawfulPurposeConfirmedAt: DECIDED,
      } as Partial<OwnMission>);
      api.on('POST /missions/me', 201, ownMission({ id: 'new-1' }));
      await show();
      vi.useRealTimers();
      await userEvent.click(screen.getByRole('button', { name: en.view.rejected.revise }));
      const [post] = api.calls.filter((c) => c.method === 'POST');
      expect(post!.body).toEqual({
        taxonomyNodeId: DD,
        title: 'Check a supplier before we sign',
        description: 'Who owns it, and whether it has been in court.',
        countryCode: 'AM',
        locationLabel: 'Yerevan',
        startBy: null,
        deadline: '2026-10-16',
        budgetMinMinor: 20_000_000,
        budgetMaxMinor: 45_000_000,
        currency: 'AMD',
        languages: ['hy', 'en'],
        purpose: 'We are about to sign a distribution contract.',
        subjectRelationship: 'BUSINESS_RELATIONSHIP',
        protectiveOrderDeclared: null,
      });
      expect(router.push).toHaveBeenCalledWith('/missions/new-1?step=review');
    });

    it('says why a new draft could not be started', async () => {
      context({ status: 'REJECTED', submittedAt: DECIDED });
      api.on(
        'POST /missions/me',
        422,
        apiError('VALIDATION_FAILED', 'error.validation.mission.category_unavailable'),
      );
      await show();
      vi.useRealTimers();
      await userEvent.click(screen.getByRole('button', { name: en.view.rejected.revise }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        catalogs.en.error.validation.mission.category_unavailable,
      );
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  describe('a mission that is not the reader’s to see', () => {
    it.each([
      [404, 'NOT_FOUND'],
      [400, 'VALIDATION_FAILED'],
    ])('is not found when the API answers %s', async (status, code) => {
      context();
      api.on(`GET /missions/me/${ID}`, status, apiError(code, 'x'));
      await expect(
        MissionPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) }),
      ).rejects.toBeInstanceOf(NotFound);
    });

    it('sends someone who cannot act as a customer to Missions', async () => {
      context();
      api.on(`GET /missions/me/${ID}`, 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      await expect(missionMeta({ params: Promise.resolve({ id: ID }) })).rejects.toEqual(
        new Redirected('/missions'),
      );
    });

    it('lets any other failure through, to the error page', async () => {
      context();
      api.on(`GET /missions/me/${ID}`, 500, apiError('INTERNAL_ERROR', 'x'));
      await expect(missionMeta({ params: Promise.resolve({ id: ID }) })).rejects.toMatchObject({
        status: 500,
      });
    });

    it('passes on a failure that is not the API’s', async () => {
      context();
      api.down(`GET /missions/me/${ID}`);
      await expect(missionMeta({ params: Promise.resolve({ id: ID }) })).rejects.toBeInstanceOf(
        TypeError,
      );
    });
  });

  describe('the customer’s list', () => {
    const list = async (missions: OwnMission[]) => {
      api.on('GET /missions/me', 200, missions);
      renderIntl(
        await resolveServer(
          await OwnMissions({ locale: 'en', now: new Date('2026-09-25T10:00:00.000Z') }),
        ),
      );
    };

    it('opens each mission, says where it stands, and when it last changed', async () => {
      await list([
        ownMission({ id: 'a', title: null }),
        ownMission({
          id: 'b',
          review: { outcome: 'CHANGES_REQUESTED', reason: 'x', decidedAt: DECIDED },
        }),
        ownMission({ id: 'c', status: 'UNDER_REVIEW' }),
      ]);
      const [a, b, c] = within(screen.getByRole('list', { name: en.own.list })).getAllByRole(
        'link',
      );
      expect(a).toHaveAttribute('href', '/missions/a');
      expect(a).toHaveTextContent(en.own.untitled);
      expect(a).toHaveTextContent(`${en.status.DRAFT}Changed 2 hours ago`);
      expect(b).toHaveTextContent(`${en.own.returned}Changed 2 hours ago`);
      expect(c).toHaveTextContent(`${en.status.UNDER_REVIEW}Changed 2 hours ago`);
      expect(b!.querySelector('[data-slot=badge]')).toHaveAttribute('data-variant', 'warning');
      expect(screen.getByRole('link', { name: en.own.new })).toHaveAttribute(
        'href',
        '/missions/new',
      );
    });

    it('says what to do when there are none', async () => {
      await list([]);
      expect(screen.getByText(en.own.empty.body)).toBeInTheDocument();
    });

    it('treats no list at all as an empty one', async () => {
      api.on('GET /missions/me', 204);
      renderIntl(await resolveServer(await OwnMissions({ locale: 'en', now: new Date() })));
      expect(screen.getByText(en.own.empty.title)).toBeInTheDocument();
    });
  });

  it('shows the shape of a question while a mission loads', () => {
    const { container } = render(<MissionLoading />);
    expect(container.querySelectorAll('[data-slot=skeleton]').length).toBeGreaterThan(3);
    expect(NewMissionLoading).toBe(MissionLoading);
  });
});
