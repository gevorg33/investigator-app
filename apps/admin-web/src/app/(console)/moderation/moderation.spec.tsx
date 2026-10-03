import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/messages';
import type { ModerationQueuePage, ModerationReviewView } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { NotFound, Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import MissionReviewPage, { generateMetadata } from './[id]/page';
import QueuePage from './page';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const ME = {
  id: 'staff-1',
  email: 'moderator@example.test',
  roles: ['STAFF'],
  timezone: 'Asia/Yerevan',
};
const ID = '00000000-0000-4000-8000-00000000051a';
const NOW = new Date('2026-10-03T09:00:00.000Z');
const REASON = 'Say which company this is about, and what you need to know about it.';

const queue = (over: Partial<ModerationQueuePage> = {}): ModerationQueuePage => ({
  items: [
    {
      id: ID,
      title: 'Is my former partner hiding assets?',
      taxonomyNodeId: 'node-assets',
      riskBand: 'RESTRICTED',
      screeningOutcome: 'PRIORITY_REVIEW',
      flagCount: 2,
      queuedAt: '2026-10-03T06:00:00.000Z',
      deadline: '2026-10-20',
    },
    {
      id: 'second',
      title: null,
      taxonomyNodeId: 'node-gone',
      riskBand: 'STANDARD',
      screeningOutcome: 'ROUTINE_REVIEW',
      flagCount: 0,
      queuedAt: '2026-10-01T09:00:00.000Z',
      deadline: null,
    },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
  ...over,
});

const mission = (over: Partial<ModerationReviewView> = {}): ModerationReviewView => ({
  id: ID,
  status: 'UNDER_REVIEW',
  version: 3,
  title: 'Is my former partner hiding assets?',
  description: 'Company shares and property.\nRegisters in Armenia.',
  purpose: 'A court case about dividing property.',
  subjectRelationship: 'FORMER_PARTNER',
  protectiveOrderDeclared: false,
  taxonomyNodeId: 'node-assets',
  countryCode: 'AM',
  locationLabel: 'Yerevan',
  languages: ['hy', 'en'],
  startBy: '2026-10-05',
  deadline: '2026-10-20',
  budgetMinMinor: 50_000,
  budgetMaxMinor: 150_000,
  currency: 'AMD',
  submittedAt: '2026-10-03T06:00:00.000Z',
  queuedAt: '2026-10-03T06:00:00.000Z',
  screening: {
    outcome: 'PRIORITY_REVIEW',
    riskBand: 'RESTRICTED',
    flags: ['partner_investigation', 'covert_tracking'],
    rulesetVersion: '2026-09-17.1',
    screenedAt: '2026-10-03T06:00:00.000Z',
    aiClassification: null,
  },
  decisions: [],
  party: false,
  ...over,
});

const TAXONOMY = [
  {
    id: 'parent',
    label: null,
    slug: 'financial',
    children: [{ id: 'node-assets', label: 'Asset tracing', slug: 'assets', children: [] }],
  },
];

const signedIn = () => {
  request.cookies.set('investigator_session', 'tok');
  api.on('GET /me', 200, ME);
};

const showQueue = async (cursor?: string) => {
  signedIn();
  api.on('GET /taxonomy?locale=en', 200, TAXONOMY);
  return render(
    await resolveServer(
      await QueuePage({
        searchParams: Promise.resolve(cursor === undefined ? {} : { cursor }),
      }),
    ),
  );
};

const showMission = async (view: ModerationReviewView = mission()) => {
  signedIn();
  api.on(`GET /moderation/missions/${ID}`, 200, view);
  api.on('GET /taxonomy?locale=en', 200, TAXONOMY);
  return render(
    await resolveServer(await MissionReviewPage({ params: Promise.resolve({ id: ID }) })),
  );
};

const section = (name: string) => screen.getByRole('region', { name });

describe('the moderation console (T-051)', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    router.reset();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('the queue', () => {
    it('lists missions as cards that open them: the band and queue in words, how long each has waited', async () => {
      api.on('GET /moderation/missions', 200, queue());
      await showQueue();
      const [first, second] = screen.getAllByRole('listitem') as [HTMLElement, HTMLElement];
      expect(within(first).getByRole('link')).toHaveAttribute('href', `/moderation/${ID}`);
      expect(within(first).getByRole('link')).toHaveTextContent(
        'Is my former partner hiding assets?',
      );
      expect(first).toHaveTextContent(t('moderation.band.RESTRICTED'));
      expect(first).toHaveTextContent(t('moderation.screening_outcome.PRIORITY_REVIEW'));
      // Queued three hours before now: the customer has been waiting that long.
      expect(first).toHaveTextContent('Queued 3 hours ago');
      expect(first).toHaveTextContent('Needed by 2026-10-20');
      expect(first).toHaveTextContent('2 flags');
      expect(first).toHaveTextContent('Asset tracing');

      expect(within(second).getByRole('link')).toHaveTextContent(t('moderation.untitled'));
      expect(second).toHaveTextContent(t('moderation.band.STANDARD'));
      expect(second).toHaveTextContent('Queued 2 days ago');
      expect(second).not.toHaveTextContent('Needed by');
      expect(second).not.toHaveTextContent('flag');
      // A category the taxonomy no longer lists is left out, not guessed at.
      expect(second.textContent).not.toContain('node-gone');
      expect(screen.queryByRole('link', { name: t('moderation.next') })).toBeNull();
      expect(screen.getByRole('link', { name: t('moderation.latency_link') })).toHaveAttribute(
        'href',
        '/moderation/latency',
      );
    });

    it('pages on, and back to the top', async () => {
      api.on(
        'GET /moderation/missions?cursor=c%2F2',
        200,
        queue({ pageInfo: { nextCursor: 'c/3', hasNextPage: true } }),
      );
      await showQueue('c/2');
      expect(screen.getByRole('link', { name: t('moderation.next') })).toHaveAttribute(
        'href',
        '/moderation?cursor=c%2F3',
      );
      expect(screen.getByRole('link', { name: t('moderation.first') })).toHaveAttribute(
        'href',
        '/moderation',
      );
    });

    it('says when nothing waits — and asks for no category names it would not show', async () => {
      api.on('GET /moderation/missions', 200, queue({ items: [] }));
      await showQueue();
      expect(screen.getByText(t('moderation.empty.title'))).toBeInTheDocument();
      expect(api.calls.some((c) => c.path.startsWith('/taxonomy'))).toBe(false);
    });

    it('says what is missing when the moderator lacks the MODERATION scope — the API refused', async () => {
      api.on('GET /moderation/missions', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      await showQueue();
      expect(screen.getByText(t('moderation.no_scope.title'))).toBeInTheDocument();
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('starts again from the top when a cursor no longer fits, and fails loudly otherwise', async () => {
      api.on(
        'GET /moderation/missions?cursor=old',
        422,
        apiError('VALIDATION_FAILED', 'error.validation.cursor.invalid'),
      );
      signedIn();
      await expect(QueuePage({ searchParams: Promise.resolve({ cursor: 'old' }) })).rejects.toEqual(
        new Redirected('/moderation'),
      );

      api.on(
        'GET /moderation/missions',
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
      );
      await expect(QueuePage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
        status: 422,
      });
      api.on('GET /moderation/missions', 500, apiError('INTERNAL', 'error.common.internal'));
      await expect(QueuePage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
        status: 500,
      });
    });

    it('lets a failure that is not the API’s propagate', async () => {
      signedIn();
      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
      await expect(QueuePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
        'network down',
      );
    });
  });

  describe('one mission', () => {
    it('shows the brief as submitted, named and formatted for a reader — and nothing about the customer', async () => {
      await showMission();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Is my former partner hiding assets?',
      );
      expect(screen.getByText(t('mission.status.UNDER_REVIEW'))).toBeInTheDocument();
      // 06:00 UTC is 10:00 in Yerevan; three hours before now.
      expect(screen.getByText(/Queued Oct 3, 2026, 10:00.* — 3 hours ago/)).toBeInTheDocument();

      const brief = section(t('mission.brief.title'));
      const facts = within(brief)
        .getAllByRole('term')
        .map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
      expect(facts).toEqual([
        [t('mission.brief.description'), 'Company shares and property.\nRegisters in Armenia.'],
        [t('mission.brief.purpose'), 'A court case about dividing property.'],
        [t('mission.brief.category'), 'Asset tracing'],
        [t('mission.brief.place'), 'Yerevan, Armenia'],
        [t('mission.brief.languages'), 'Armenian, English'],
        [t('mission.brief.timing'), 'Start by 2026-10-05, needed by 2026-10-20'],
        [t('mission.brief.budget'), expect.stringMatching(/500.*1,500/)],
        [t('mission.brief.relationship'), t('mission.relationship.FORMER_PARTNER')],
        [t('mission.brief.protective_order'), t('mission.brief.protective_order.no')],
      ]);
    });

    it('says what was not given rather than inventing it', async () => {
      await showMission(
        mission({
          title: null,
          description: null,
          purpose: null,
          taxonomyNodeId: null,
          countryCode: null,
          languages: [],
          startBy: null,
          deadline: null,
          budgetMinMinor: null,
          subjectRelationship: null,
          protectiveOrderDeclared: null,
          queuedAt: null,
        }),
      );
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t('moderation.untitled'));
      const values = within(section(t('mission.brief.title')))
        .getAllByRole('definition')
        .map((dd) => dd.textContent);
      expect(values.every((v) => v === t('mission.brief.none'))).toBe(true);
      expect(screen.queryByText(/^Queued/)).toBeNull();
    });

    it('names what it can: a deadline with no start, a declared order, a category since retired, a place with no label', async () => {
      await showMission(
        mission({
          startBy: null,
          protectiveOrderDeclared: true,
          taxonomyNodeId: '99999999-dead-4000-8000-000000000000',
          locationLabel: null,
        }),
      );
      const brief = section(t('mission.brief.title'));
      expect(brief).toHaveTextContent('Needed by 2026-10-20');
      expect(brief).toHaveTextContent(t('mission.brief.protective_order.yes'));
      expect(brief).toHaveTextContent('A category no longer in the taxonomy (99999999)');
      expect(brief).toHaveTextContent(/Where\s*Armenia/);
    });

    it('shows the screening as what sorted it — band, queue, the rules matched — and that it decided nothing', async () => {
      await showMission();
      const screening = section(t('mission.screening.title'));
      expect(screening).toHaveTextContent(t('mission.screening.note'));
      expect(screening).toHaveTextContent(t('moderation.band.RESTRICTED'));
      expect(screening).toHaveTextContent(t('moderation.screening_outcome.PRIORITY_REVIEW'));
      expect(
        within(screening)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(['partner_investigation', 'covert_tracking']);
      expect(screening).toHaveTextContent(/Ruleset 2026-09-17\.1, screened Oct 3, 2026/);
    });

    it('says when nothing was matched', async () => {
      await showMission(
        mission({
          screening: {
            ...mission().screening!,
            flags: [],
            riskBand: 'STANDARD',
            outcome: 'ROUTINE_REVIEW',
          },
        }),
      );
      expect(section(t('mission.screening.title'))).toHaveTextContent(
        `${t('mission.screening.flags')}${t('mission.screening.no_flags')}`,
      );
    });

    it('sets the AI classification apart, labelled as input, and pre-selects nothing from it', async () => {
      const classification = { suggestedOutcome: 'PUBLISHED', confidence: 0.97 };
      await showMission(
        mission({ screening: { ...mission().screening!, aiClassification: classification } }),
      );
      const ai = section(t('mission.ai.title'));
      expect(ai).toHaveTextContent(t('mission.ai.note'));
      expect(ai).toHaveTextContent('"suggestedOutcome": "PUBLISHED"');

      await userEvent.click(screen.getByRole('button', { name: t('moderate.open') }));
      const sheet = await screen.findByRole('dialog', { name: t('moderate.title') });
      for (const radio of within(sheet).getAllByRole('radio')) expect(radio).not.toBeChecked();
      expect(within(sheet).getByRole('button', { name: t('moderate.submit') })).toBeDisabled();
    });

    it('says when there is no AI classification', async () => {
      await showMission();
      expect(section(t('mission.ai.title'))).toHaveTextContent(t('mission.ai.none'));
    });

    it('shows every decision across submissions: what the customer read, and the internal note apart', async () => {
      await showMission(
        mission({
          decisions: [
            {
              outcome: 'CHANGES_REQUESTED',
              reason: REASON,
              internalNote: 'Reads like a partner check.',
              decidedBy: 'moderator-9aaaaaaa',
              decidedAt: '2026-10-01T08:00:00.000Z',
              missionVersion: 1,
            },
            {
              outcome: 'PUBLISHED',
              reason: 'Now names the company.',
              internalNote: null,
              decidedBy: 'moderator-8bbbbbbb',
              decidedAt: '2026-10-02T08:00:00.000Z',
              missionVersion: 3,
            },
          ],
        }),
      );
      const [returned, published] = within(section(t('mission.decisions.title'))).getAllByRole(
        'listitem',
      ) as [HTMLElement, HTMLElement];
      expect(returned).toHaveTextContent(
        /Returned for changes on Oct 1, 2026, 12:00.* by moderato/,
      );
      expect(returned).toHaveTextContent(`${t('mission.decisions.customer_read')}${REASON}`);
      expect(returned).toHaveTextContent(
        `${t('mission.decisions.internal_note')}Reads like a partner check.`,
      );
      expect(published).toHaveTextContent(`${t('mission.decisions.reason')}Now names the company.`);
      expect(published).not.toHaveTextContent(t('mission.decisions.internal_note'));
    });

    it('says when no decision has been made', async () => {
      await showMission();
      expect(section(t('mission.decisions.title'))).toHaveTextContent(t('mission.decisions.none'));
    });

    it('does not offer a decision on the moderator’s own mission, and says why', async () => {
      await showMission(mission({ party: true }));
      expect(section(t('moderate.title'))).toHaveTextContent(t('mission.party'));
      expect(screen.queryByRole('button', { name: t('moderate.open') })).toBeNull();
    });

    it.each([
      ['QUOTED', t('mission.status.QUOTED')],
      ['REJECTED', t('mission.status.REJECTED')],
      ['DRAFT', t('mission.status.DRAFT')],
      ['CANCELLED', t('mission.status.other')],
    ])(
      'offers no decision once it is %s, and says where the decisions are',
      async (status, label) => {
        await showMission(mission({ status }));
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(section(t('moderate.title'))).toHaveTextContent(t('mission.decided'));
        expect(screen.queryByRole('button', { name: t('moderate.open') })).toBeNull();
      },
    );

    it('says a mission with no screening must not be decided, and offers no decision', async () => {
      await showMission(mission({ screening: null }));
      expect(section(t('mission.screening.title'))).toHaveTextContent(
        t('mission.screening.missing'),
      );
      expect(section(t('mission.ai.title'))).toHaveTextContent(t('mission.ai.none'));
      expect(screen.queryByRole('button', { name: t('moderate.open') })).toBeNull();
    });

    it('is not found when there is none, or the id is not one; refused without the scope', async () => {
      signedIn();
      for (const status of [404, 400]) {
        api.on(
          `GET /moderation/missions/${ID}`,
          status,
          apiError('NOT_FOUND', 'error.common.not_found'),
        );
        await expect(
          MissionReviewPage({ params: Promise.resolve({ id: ID }) }),
        ).rejects.toBeInstanceOf(NotFound);
      }
      api.on(`GET /moderation/missions/${ID}`, 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      render(await resolveServer(await MissionReviewPage({ params: Promise.resolve({ id: ID }) })));
      expect(screen.getByText(t('moderation.no_scope.title'))).toBeInTheDocument();
      expect(await generateMetadata({ params: Promise.resolve({ id: ID }) })).toEqual({
        title: t('moderation.title'),
      });
    });

    it('fails loudly on anything else', async () => {
      signedIn();
      api.on(`GET /moderation/missions/${ID}`, 500, apiError('INTERNAL', 'error.common.internal'));
      await expect(
        MissionReviewPage({ params: Promise.resolve({ id: ID }) }),
      ).rejects.toMatchObject({
        status: 500,
      });
      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
      await expect(MissionReviewPage({ params: Promise.resolve({ id: 'other' }) })).rejects.toThrow(
        'network down',
      );
    });

    it('titles the page by the mission, or says it has none', async () => {
      signedIn();
      api.on(`GET /moderation/missions/${ID}`, 200, mission());
      expect(await generateMetadata({ params: Promise.resolve({ id: ID }) })).toEqual({
        title: 'Is my former partner hiding assets?',
      });
      api.on('GET /moderation/missions/untitled', 200, mission({ id: 'untitled', title: null }));
      expect(await generateMetadata({ params: Promise.resolve({ id: 'untitled' }) })).toEqual({
        title: t('moderation.untitled'),
      });
    });
  });

  describe('deciding', () => {
    const open = async () => {
      await userEvent.click(screen.getByRole('button', { name: t('moderate.open') }));
      return screen.findByRole('dialog', { name: t('moderate.title') });
    };

    it('keeps the control disabled until an outcome is chosen and the reason says something', async () => {
      await showMission();
      const sheet = await open();
      const submit = within(sheet).getByRole('button', { name: t('moderate.submit') });
      const reason = within(sheet).getByRole('textbox', { name: t('moderate.reason') });
      expect(reason).toHaveAccessibleDescription(t('moderate.reason_hint'));
      expect(submit).toBeDisabled();

      await userEvent.type(reason, '   ');
      await userEvent.click(within(sheet).getByRole('radio', { name: t('moderate.reject') }));
      expect(submit).toBeDisabled();
      await userEvent.type(reason, 'x');
      expect(submit).toBeEnabled();
    });

    it('labels the reason by who reads it: the customer on a rejection or a return, staff on a publication', async () => {
      await showMission();
      const sheet = await open();
      for (const [outcome, label, hint] of [
        [t('moderate.reject'), t('moderate.reason.customer'), t('moderate.reason.customer_hint')],
        [
          t('moderate.request_changes'),
          t('moderate.reason.customer'),
          t('moderate.reason.customer_hint'),
        ],
        [t('moderate.publish'), t('moderate.reason.staff'), t('moderate.reason.staff_hint')],
      ] as const) {
        await userEvent.click(within(sheet).getByRole('radio', { name: outcome }));
        expect(within(sheet).getByRole('textbox', { name: label })).toHaveAccessibleDescription(
          hint,
        );
      }
      expect(
        within(sheet).getByRole('textbox', { name: t('moderate.note') }),
      ).toHaveAccessibleDescription(t('moderate.note_hint'));
    });

    it('records a return with its reason and internal note, at the version read, then reads the page again', async () => {
      await showMission();
      api.on(`POST /moderation/missions/${ID}/decision`, 201, { outcome: 'CHANGES_REQUESTED' });
      const sheet = await open();
      await userEvent.click(
        within(sheet).getByRole('radio', { name: t('moderate.request_changes') }),
      );
      await userEvent.type(
        within(sheet).getByRole('textbox', { name: t('moderate.reason.customer') }),
        `  ${REASON}  `,
      );
      await userEvent.type(
        within(sheet).getByRole('textbox', { name: t('moderate.note') }),
        ' Reads like a partner check. ',
      );
      await userEvent.click(within(sheet).getByRole('button', { name: t('moderate.submit') }));
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(api.calls.at(-1)).toMatchObject({
        method: 'POST',
        body: {
          outcome: 'CHANGES_REQUESTED',
          reason: REASON,
          internalNote: 'Reads like a partner check.',
          version: 3,
        },
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('sends no internal note when none was written', async () => {
      await showMission();
      api.on(`POST /moderation/missions/${ID}/decision`, 201, { outcome: 'PUBLISHED' });
      const sheet = await open();
      await userEvent.click(within(sheet).getByRole('radio', { name: t('moderate.publish') }));
      await userEvent.type(
        within(sheet).getByRole('textbox', { name: t('moderate.reason.staff') }),
        'Ordinary company check.',
      );
      await userEvent.type(within(sheet).getByRole('textbox', { name: t('moderate.note') }), '   ');
      await userEvent.click(within(sheet).getByRole('button', { name: t('moderate.submit') }));
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(api.calls.at(-1)?.body).toEqual({
        outcome: 'PUBLISHED',
        reason: 'Ordinary company check.',
        version: 3,
      });
    });

    it('says the mission moved on when someone else decided it first, and stays open', async () => {
      await showMission();
      api.on(
        `POST /moderation/missions/${ID}/decision`,
        409,
        apiError('STATE_CONFLICT', 'error.common.state_conflict'),
      );
      const sheet = await open();
      await userEvent.click(within(sheet).getByRole('radio', { name: t('moderate.reject') }));
      await userEvent.type(
        within(sheet).getByRole('textbox', { name: t('moderate.reason.customer') }),
        REASON,
      );
      await userEvent.click(within(sheet).getByRole('button', { name: t('moderate.submit') }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(t('moderate.conflict'));
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('opens from the side from tablet width, and closes on Cancel without sending', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: true,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      await showMission();
      const sheet = await open();
      expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'right');
      await userEvent.click(within(sheet).getByRole('button', { name: t('moderate.cancel') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    });
  });
});
