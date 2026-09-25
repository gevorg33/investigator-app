import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from '@/app/sign-in/page';
import { t } from '@/i18n/messages';
import type { QueuePage, ReviewView } from '@/lib/api/types';
import { middleware, PATHNAME_HEADER } from '@/middleware';
import { api, apiError } from '@/test/api';
import { NotFound, Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import ConsoleLayout from '../layout';
import ReviewPage, { generateMetadata } from './[id]/page';
import VerificationQueuePage from './page';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const navigated = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('@/lib/navigate', () => ({ navigate: (url: string) => navigated.to.push(url) }));

const ME = {
  id: 'staff-1',
  email: 'reviewer@example.test',
  roles: ['STAFF'],
  timezone: 'Asia/Yerevan',
};
const ID = '00000000-0000-4000-8000-00000000c070';
const DOC = 'aaaaaaaa-0000-4000-8000-000000000001';

const queue = (over: Partial<QueuePage> = {}): QueuePage => ({
  items: [
    {
      id: ID,
      profileId: '11111111-2222-4333-8444-555555555555',
      submittedAt: '2026-09-20T08:00:00.000Z',
      documentCount: 2,
    },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
  ...over,
});

const review = (over: Partial<ReviewView> = {}): ReviewView => ({
  id: ID,
  status: 'SUBMITTED',
  submittedAt: '2026-09-20T08:00:00.000Z',
  declaredScope: {
    specialtyNodeIds: ['node-fraud', '99999999-dead-4000-8000-000000000000'],
    serviceAreas: [
      {
        id: 'area-1',
        label: 'Yerevan and around',
        countryCode: 'AM',
        region: null,
        city: 'Yerevan',
      },
    ],
  },
  profile: {
    id: '11111111-2222-4333-8444-555555555555',
    userId: 'applicant-1',
    headline: 'Due diligence in the South Caucasus',
    verificationStatus: 'PENDING',
    verifiedAt: null,
  },
  documents: [
    {
      mediaAssetId: DOC,
      declaredMimeType: 'application/pdf',
      bytes: 2_400_000,
      scanStatus: 'CLEAN',
    },
    {
      mediaAssetId: 'doc-2',
      declaredMimeType: 'image/jpeg',
      bytes: 180_000,
      scanStatus: 'PENDING',
    },
    { mediaAssetId: 'doc-3', declaredMimeType: 'image/png', bytes: null, scanStatus: 'INFECTED' },
    { mediaAssetId: 'doc-4', declaredMimeType: 'image/png', bytes: 512, scanStatus: 'FAILED' },
  ],
  trail: [
    { requestId: ID, status: 'SUBMITTED', submittedAt: '2026-09-20T08:00:00.000Z', decision: null },
    {
      requestId: 'earlier-1',
      status: 'REJECTED',
      submittedAt: '2026-08-01T08:00:00.000Z',
      decision: {
        outcome: 'REJECTED',
        reason: 'The licence had expired.\nSend the renewed one.',
        decidedBy: 'reviewer-9aaaaaaa',
        decidedAt: '2026-08-02T10:00:00.000Z',
      },
    },
  ],
  ...over,
});

const TAXONOMY = [
  {
    id: 'parent',
    label: null,
    slug: 'corporate',
    children: [{ id: 'node-fraud', label: 'Fraud investigation', slug: 'fraud', children: [] }],
  },
];

const signedIn = () => {
  request.cookies.set('investigator_session', 'tok');
  api.on('GET /me', 200, ME);
};
const showReview = async (view: ReviewView = review()) => {
  signedIn();
  api.on(`GET /verification/requests/${ID}`, 200, view);
  api.on('GET /taxonomy?locale=en', 200, TAXONOMY);
  return render(await resolveServer(await ReviewPage({ params: Promise.resolve({ id: ID }) })));
};

describe('the staff verification console (T-070)', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    router.reset();
    navigated.to = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('who gets in', () => {
    it('sends a reader with no session on this origin to sign in, and back after', async () => {
      request.headers.set(PATHNAME_HEADER, `/verification/${ID}`);
      api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
      await expect(ConsoleLayout({ children: 'inside' })).rejects.toEqual(
        new Redirected(`/sign-in?next=${encodeURIComponent(`/verification/${ID}`)}`),
      );
      request.headers.clear();
      await expect(ConsoleLayout({ children: 'inside' })).rejects.toEqual(
        new Redirected('/sign-in?next=%2Fverification'),
      );
    });

    it('forwards only this origin’s session cookie to the API', async () => {
      request.cookies.set('investigator_session', 'tok');
      request.cookies.set('active_role', 'CUSTOMER');
      api.on('GET /me', 200, ME);
      render(await resolveServer(await ConsoleLayout({ children: 'inside' })));
      expect(api.calls[0]).toMatchObject({
        origin: 'http://localhost:3001',
        headers: { cookie: 'investigator_session=tok' },
      });
      expect(api.calls[0]!.init.cache).toBe('no-store');
    });

    it('tells someone signed in, but not as staff, that the console is not for them — and lets them out', async () => {
      api.on('GET /me', 200, { ...ME, roles: ['CUSTOMER', 'INVESTIGATOR'] });
      render(await resolveServer(await ConsoleLayout({ children: 'inside' })));
      expect(screen.getByRole('heading', { name: t('staff_only.title') })).toBeInTheDocument();
      expect(screen.queryByText('inside')).toBeNull();
      api.on('POST /auth/logout', 204);
      await userEvent.click(screen.getByRole('button', { name: t('shell.sign_out') }));
      await waitFor(() => expect(navigated.to).toEqual(['/sign-in']));
    });

    it('frames staff in the console: the queue, who is signed in, sign-out, a skip link', async () => {
      signedIn();
      render(await resolveServer(await ConsoleLayout({ children: 'inside' })));
      expect(screen.getByRole('main')).toHaveTextContent('inside');
      const nav = screen.getByRole('navigation', { name: t('shell.nav.label') });
      expect(within(nav).getByRole('link', { name: t('shell.verification') })).toHaveAttribute(
        'href',
        '/verification',
      );
      expect(screen.getByText('Signed in as reviewer@example.test')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: t('shell.skip_to_content') })).toHaveAttribute(
        'href',
        '#content',
      );
    });

    it('passes a gone session on as the error it is, not as someone signed out', async () => {
      api.on('GET /me', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await expect(ConsoleLayout({ children: 'inside' })).rejects.toMatchObject({ status: 500 });
    });

    it('marks every page request with the path asked for — over whatever a client claims', () => {
      const req = new Request('http://localhost:3002/verification?cursor=x', {
        headers: { [PATHNAME_HEADER]: '/evil' },
      });
      const res = middleware(
        Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as Parameters<
          typeof middleware
        >[0],
      );
      expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe(
        '/verification?cursor=x',
      );
    });
  });

  describe('signing in', () => {
    it('signs in on this origin and goes back where the reviewer was — on this site only', async () => {
      render(await SignInPage({ searchParams: Promise.resolve({ next: `/verification/${ID}` }) }));
      expect(
        screen.getByRole('heading', { level: 1, name: t('sign_in.title') }),
      ).toBeInTheDocument();
      api.on('POST /auth/login', 200, { userId: 'staff-1' });
      await userEvent.type(screen.getByLabelText(t('sign_in.email')), 'reviewer@example.test');
      await userEvent.type(screen.getByLabelText(t('sign_in.password')), 'a long passphrase');
      await userEvent.click(screen.getByRole('button', { name: t('sign_in.submit') }));
      await waitFor(() => expect(navigated.to).toEqual([`/verification/${ID}`]));
      expect(api.calls[0]).toMatchObject({
        origin: '',
        body: { email: 'reviewer@example.test', password: 'a long passphrase' },
      });
    });

    it('never follows a `next` that leaves the site', async () => {
      render(await SignInPage({ searchParams: Promise.resolve({ next: '//evil.example' }) }));
      api.on('POST /auth/login', 200, { userId: 'staff-1' });
      await userEvent.type(screen.getByLabelText(t('sign_in.email')), 'reviewer@example.test');
      await userEvent.type(screen.getByLabelText(t('sign_in.password')), 'a long passphrase');
      await userEvent.click(screen.getByRole('button', { name: t('sign_in.submit') }));
      await waitFor(() => expect(navigated.to).toEqual(['/']));
    });

    it('says the same thing for every refusal, never whether an address is registered', async () => {
      render(await SignInPage({ searchParams: Promise.resolve({}) }));
      for (const [status, code, key] of [
        [401, 'UNAUTHENTICATED', 'error.auth.unauthenticated'],
        [400, 'VALIDATION_FAILED', 'error.common.validation_failed'],
      ] as const) {
        api.on('POST /auth/login', status, apiError(code, key));
        await userEvent.clear(screen.getByLabelText(t('sign_in.email')));
        await userEvent.type(screen.getByLabelText(t('sign_in.email')), 'someone@example.test');
        await userEvent.type(screen.getByLabelText(t('sign_in.password')), 'x');
        await userEvent.click(screen.getByRole('button', { name: t('sign_in.submit') }));
        expect(await screen.findByRole('alert')).toHaveTextContent(t('sign_in.failed'));
      }
      expect(navigated.to).toEqual([]);
    });

    it('says what went wrong when signing out fails, and stays', async () => {
      api.on('GET /me', 200, { ...ME, roles: [] });
      render(await resolveServer(await ConsoleLayout({ children: 'inside' })));
      api.on(
        'POST /auth/logout',
        500,
        apiError('INTERNAL_ERROR', 'error.common.internal', { correlationId: 'req-9' }),
      );
      await userEvent.click(screen.getByRole('button', { name: t('shell.sign_out') }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Reference: req-9');
      expect(navigated.to).toEqual([]);
    });
  });

  describe('the queue', () => {
    const showQueue = async (cursor?: string) => {
      signedIn();
      return render(
        await resolveServer(
          await VerificationQueuePage({
            searchParams: Promise.resolve(cursor === undefined ? {} : { cursor }),
          }),
        ),
      );
    };

    it('lists what waits, oldest first, as cards that open the application — dated in the reviewer’s zone', async () => {
      api.on('GET /verification/requests', 200, queue());
      await showQueue();
      const card = screen.getByRole('listitem');
      const link = within(card).getByRole('link');
      expect(link).toHaveAttribute('href', `/verification/${ID}`);
      // 08:00 UTC is noon in Yerevan: the reviewer's own time.
      expect(link).toHaveTextContent(/Application from Sep 20, 2026, 12:00/);
      expect(card).toHaveTextContent('2 documents');
      expect(card).toHaveTextContent('Profile 11111111');
      expect(screen.queryByRole('link', { name: t('verification.next') })).toBeNull();
    });

    it('pages on, and back to the oldest', async () => {
      api.on(
        'GET /verification/requests?cursor=c%2F2',
        200,
        queue({ pageInfo: { nextCursor: 'c/3', hasNextPage: true } }),
      );
      await showQueue('c/2');
      expect(screen.getByRole('link', { name: t('verification.next') })).toHaveAttribute(
        'href',
        '/verification?cursor=c%2F3',
      );
      expect(screen.getByRole('link', { name: t('verification.first') })).toHaveAttribute(
        'href',
        '/verification',
      );
    });

    it('says when nothing waits', async () => {
      api.on('GET /verification/requests', 200, queue({ items: [] }));
      await showQueue();
      expect(
        screen.getByRole('heading', { name: t('verification.empty.title') }),
      ).toBeInTheDocument();
    });

    it('says what is missing when the reviewer lacks the VERIFICATION scope — the API refused', async () => {
      api.on('GET /verification/requests', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      await showQueue();
      expect(
        screen.getByRole('heading', { name: t('verification.no_scope.title') }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('starts again from the oldest when a cursor no longer fits, and fails loudly otherwise', async () => {
      api.on(
        'GET /verification/requests?cursor=old',
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
      );
      await expect(showQueue('old')).rejects.toEqual(new Redirected('/verification'));
      api.on(
        'GET /verification/requests',
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
      );
      await expect(showQueue()).rejects.toMatchObject({ status: 422 });
      api.down('GET /verification/requests');
      await expect(showQueue()).rejects.toThrow(TypeError);
    });
  });

  describe('one application', () => {
    it('shows the declaration recorded on the application — named from the taxonomy — not the live profile', async () => {
      await showReview();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        /Application from Sep 20, 2026/,
      );
      expect(screen.getByText(t('review.status.SUBMITTED'))).toBeInTheDocument();
      expect(screen.getByText(t('review.declared.note'))).toBeInTheDocument();
      const declared = screen.getByRole('region', { name: t('review.declared.title') });
      expect(within(declared).getByText('Fraud investigation')).toBeInTheDocument();
      // A specialty retired since is still shown — as what it is, not dropped.
      expect(
        within(declared).getByText('A specialty no longer in the taxonomy (99999999)'),
      ).toBeInTheDocument();
      expect(within(declared).getByText('Yerevan and around · Yerevan · AM')).toBeInTheDocument();
      expect(screen.getByText('Due diligence in the South Caucasus')).toBeInTheDocument();
      // Nothing else was read to build it: the application and the taxonomy's names.
      expect(api.calls.map((c) => c.path).sort()).toEqual([
        '/me',
        '/taxonomy?locale=en',
        `/verification/requests/${ID}`,
      ]);
    });

    it('says what is missing rather than inventing it', async () => {
      await showReview(
        review({
          declaredScope: { specialtyNodeIds: [], serviceAreas: [] },
          profile: { ...review().profile, headline: null },
        }),
      );
      const declared = screen.getByRole('region', { name: t('review.declared.title') });
      expect(within(declared).getAllByText(t('review.declared.none'))).toHaveLength(2);
      expect(screen.getByText(t('review.no_headline'))).toBeInTheDocument();
    });

    it('offers to open only clean documents, and says why each other one cannot be', async () => {
      await showReview();
      const docs = within(
        screen.getByRole('region', { name: t('review.documents.title') }),
      ).getAllByRole('listitem');
      expect(docs[0]).toHaveTextContent('application/pdf, 2.3 MB');
      expect(within(docs[0]!).getByRole('button', { name: 'Open document 1' })).toBeInTheDocument();
      expect(docs[1]).toHaveTextContent('image/jpeg, 176 KB');
      expect(docs[1]).toHaveTextContent(t('review.documents.scan.PENDING'));
      expect(docs[2]).toHaveTextContent(`image/png, ${t('review.documents.unknown_size')}`);
      expect(docs[2]).toHaveTextContent(t('review.documents.scan.INFECTED'));
      expect(docs[3]).toHaveTextContent('image/png, 1 KB');
      expect(docs[3]).toHaveTextContent(t('review.documents.scan.FAILED'));
      for (const d of docs.slice(1)) expect(within(d).queryByRole('button')).toBeNull();
    });

    it('shows the whole trail, this application marked, each decision with its reason and who made it', async () => {
      await showReview();
      const trail = within(
        screen.getByRole('region', { name: t('review.trail.title') }),
      ).getAllByRole('listitem');
      expect(trail[0]).toHaveAttribute('aria-current', 'true');
      expect(trail[0]).toHaveTextContent(t('review.trail.this'));
      expect(trail[0]).toHaveTextContent(t('review.trail.waiting'));
      expect(trail[1]).toHaveTextContent(/Rejected on Aug 2, 2026, .* by reviewer/);
      expect(trail[1]).toHaveTextContent('The licence had expired.');
      expect(trail[1]).not.toHaveAttribute('aria-current');
    });

    it('does not offer a decision on the reviewer’s own application, and says why', async () => {
      await showReview(review({ profile: { ...review().profile, userId: ME.id } }));
      expect(screen.getByRole('status')).toHaveTextContent(t('review.own'));
      expect(screen.queryByRole('button', { name: t('decision.open') })).toBeNull();
    });

    it('offers no decision once one is made', async () => {
      await showReview(review({ status: 'APPROVED' }));
      expect(screen.getByText(t('review.decided'))).toBeInTheDocument();
      expect(screen.getByText(t('review.status.APPROVED'))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t('decision.open') })).toBeNull();
    });

    it('is not found when there is none, or the id is not one; refused without the scope', async () => {
      signedIn();
      for (const status of [404, 400] as const) {
        api.on(
          `GET /verification/requests/${ID}`,
          status,
          apiError(status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED', 'error.common.not_found'),
        );
        await expect(ReviewPage({ params: Promise.resolve({ id: ID }) })).rejects.toBeInstanceOf(
          NotFound,
        );
      }
      api.on(
        `GET /verification/requests/${ID}`,
        403,
        apiError('FORBIDDEN', 'error.auth.forbidden'),
      );
      render(await resolveServer(await ReviewPage({ params: Promise.resolve({ id: ID }) })));
      expect(
        screen.getByRole('heading', { name: t('verification.no_scope.title') }),
      ).toBeInTheDocument();
      expect((await generateMetadata({ params: Promise.resolve({ id: ID }) })).title).toBe(
        t('verification.title'),
      );
      api.on('GET /verification/requests/other', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await expect(ReviewPage({ params: Promise.resolve({ id: 'other' }) })).rejects.toMatchObject({
        status: 500,
      });
      api.down('GET /verification/requests/third');
      await expect(ReviewPage({ params: Promise.resolve({ id: 'third' }) })).rejects.toThrow(TypeError);
    });

    it('titles the page by its date', async () => {
      signedIn();
      api.on(`GET /verification/requests/${ID}`, 200, review());
      expect((await generateMetadata({ params: Promise.resolve({ id: ID }) })).title).toBe(
        'Application from 2026-09-20',
      );
    });

    it('names nothing it cannot when the taxonomy is empty', async () => {
      signedIn();
      api.on(`GET /verification/requests/${ID}`, 200, review());
      api.on('GET /taxonomy?locale=en', 200, undefined);
      render(await resolveServer(await ReviewPage({ params: Promise.resolve({ id: ID }) })));
      expect(screen.getAllByText(/A specialty no longer in the taxonomy/)).toHaveLength(2);
    });
  });

  describe('opening a document', () => {
    const tab = () => {
      const opened = {
        opener: 'the console' as unknown,
        location: { href: 'about:blank' },
        close: vi.fn(),
      };
      const open = vi.fn(() => opened);
      vi.stubGlobal('open', open);
      return { opened, open };
    };
    const URL_PATH = `GET /verification/requests/${ID}/documents/${DOC}/delivery-url`;

    it('goes through the audited route, into a tab cut off from the console — the link never shown', async () => {
      const { opened, open } = tab();
      await showReview();
      api.on(URL_PATH, 200, {
        signedUrl: 'https://res.cloudinary.test/signed/secret-token',
        expiresAt: '2026-09-25T12:05:00Z',
      });
      await userEvent.click(screen.getByRole('button', { name: 'Open document 1' }));
      await waitFor(() =>
        expect(opened.location.href).toBe('https://res.cloudinary.test/signed/secret-token'),
      );
      expect(open).toHaveBeenCalledWith('about:blank', '_blank');
      expect(opened.opener).toBeNull();
      expect(document.body.innerHTML).not.toContain('secret-token');
      expect(api.calls.at(-1)).toMatchObject({ method: 'GET', origin: '' });
    });

    it('closes the tab and says why when the link is refused', async () => {
      const { opened } = tab();
      await showReview();
      api.on(URL_PATH, 409, apiError('STATE_CONFLICT', 'error.common.state_conflict'));
      await userEvent.click(screen.getByRole('button', { name: 'Open document 1' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(t('error.common.state_conflict'));
      expect(opened.close).toHaveBeenCalled();
    });

    it('closes the tab when the network drops too', async () => {
      const { opened } = tab();
      await showReview();
      api.down(URL_PATH);
      await userEvent.click(screen.getByRole('button', { name: 'Open document 1' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(t('error.common.internal'));
      expect(opened.close).toHaveBeenCalled();
    });

    it('asks for no link — each is an audited opening — when the browser blocks the tab', async () => {
      vi.stubGlobal(
        'open',
        vi.fn(() => null),
      );
      await showReview();
      await userEvent.click(screen.getByRole('button', { name: 'Open document 1' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(t('review.documents.blocked'));
      expect(api.calls.some((c) => c.path.includes('delivery-url'))).toBe(false);
    });
  });

  describe('deciding', () => {
    const decide = async (outcome: 'Approve' | 'Reject', reason: string) => {
      await userEvent.click(screen.getByRole('button', { name: t('decision.open') }));
      const sheet = await screen.findByRole('dialog', { name: t('decision.title') });
      await userEvent.click(within(sheet).getByRole('radio', { name: outcome }));
      if (reason !== '')
        await userEvent.type(
          within(sheet).getByRole('textbox', { name: t('decision.reason') }),
          reason,
        );
      await userEvent.click(within(sheet).getByRole('button', { name: t('decision.submit') }));
      return sheet;
    };

    it('records the outcome and its reason, then reads the page again', async () => {
      await showReview();
      api.on(`POST /verification/requests/${ID}/decision`, 200, { id: ID });
      await decide('Reject', '  The licence does not cover surveillance.  ');
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(api.calls.at(-1)).toMatchObject({
        method: 'POST',
        body: { outcome: 'REJECTED', reason: 'The licence does not cover surveillance.' },
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('asks for both an outcome and a reason, and will not send a reason of spaces', async () => {
      await showReview();
      await userEvent.click(screen.getByRole('button', { name: t('decision.open') }));
      const sheet = await screen.findByRole('dialog', { name: t('decision.title') });
      for (const radio of within(sheet).getAllByRole('radio')) expect(radio).toBeRequired();
      const reason = within(sheet).getByRole('textbox', { name: t('decision.reason') });
      expect(reason).toBeRequired();
      expect(reason).toHaveAccessibleDescription(t('decision.reason_hint'));
      await userEvent.click(within(sheet).getByRole('radio', { name: 'Approve' }));
      await userEvent.type(reason, '   ');
      await userEvent.click(within(sheet).getByRole('button', { name: t('decision.submit') }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(
        t('error.validation.verification.reason_required'),
      );
      expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('says the application moved on when someone else decided it first', async () => {
      await showReview();
      api.on(
        `POST /verification/requests/${ID}/decision`,
        409,
        apiError('STATE_CONFLICT', 'error.common.state_conflict'),
      );
      const sheet = await decide('Approve', 'Licence checked against the register.');
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(t('decision.conflict'));
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('opens from the side from tablet width, and closes on Cancel without sending', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: true,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      await showReview();
      await userEvent.click(screen.getByRole('button', { name: t('decision.open') }));
      const sheet = await screen.findByRole('dialog', { name: t('decision.title') });
      expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'right');
      await userEvent.click(within(sheet).getByRole('button', { name: t('decision.cancel') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    });
  });
});
