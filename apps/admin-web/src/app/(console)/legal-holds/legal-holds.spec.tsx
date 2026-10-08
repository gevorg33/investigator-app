import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/messages';
import type { LegalHold, LegalHoldPage } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import LegalHoldsPage, { metadata } from './page';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

// No pause between keystrokes and steps (`delay: null`), as in app-web's specs (T-180).
const user = () => userEvent.setup({ delay: null });
/**
 * A long value as staff enter one — a record's id copied from elsewhere, a reason drafted elsewhere:
 * pasted. Typed, each character is a render; a walk-through typing a hundred of them took 5.8 s of a
 * 5 s budget under a full `pnpm test`, and the abandoned test kept typing into the next one's focused
 * field (T-236). Keystrokes stay where they are the point: crossing a minimum, a blank answer.
 */
const paste = async (field: HTMLElement, text: string) => {
  const u = user();
  await u.click(field);
  await u.paste(text);
};

const ME = {
  id: 'staff-1',
  email: 'compliance@example.test',
  roles: ['STAFF'],
  timezone: 'Asia/Yerevan',
};
const ACCOUNT = 'e18bbb58-fe24-4153-8369-b724e1f5220a';
const MISSION = '0b4d7c1e-2f3a-4b5c-8d6e-7f8091a2b3c4';
const HOLD = '8abd1d41-690b-4181-8f3c-a899f7c0cacd';
const REASON = 'Preservation request PR-2026-114 from the investigating authority.';
const RELEASE = 'Counsel confirmed the preservation period has ended.';

const hold = (over: Partial<LegalHold> = {}): LegalHold => ({
  id: HOLD,
  resourceType: 'USER',
  resourceId: ACCOUNT,
  reason: REASON,
  placedBy: 'a1b2c3d4-0000-4000-8000-000000000001',
  placedAt: '2026-10-05T06:00:00.000Z',
  release: null,
  ...over,
});

const released = hold({
  id: 'released-1',
  resourceType: 'MISSION',
  resourceId: MISSION,
  release: {
    at: '2026-10-05T08:30:00.000Z',
    by: 'f9e8d7c6-0000-4000-8000-000000000002',
    reason: RELEASE,
  },
});

const page = (items: LegalHold[], nextCursor: string | null = null): LegalHoldPage => ({
  items,
  pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
});

type Params = { status?: string; resourceType?: string; resourceId?: string; cursor?: string };

const show = async (params: Params = {}) => {
  request.cookies.set('__Host-investigator_session', 'tok');
  api.on('GET /me', 200, ME);
  return render(
    await resolveServer(await LegalHoldsPage({ searchParams: Promise.resolve(params) })),
  );
};
const listed = (query: string, body: LegalHoldPage) =>
  api.on(`GET /legal-holds?${query}`, 200, body);
const cards = () => screen.getAllByRole('listitem');
const listCalls = () =>
  api.calls.filter((c) => c.path.startsWith('/legal-holds')).map((c) => c.path);
const statusNav = () => screen.getByRole('navigation', { name: t('holds.status.label') });

describe('legal holds in the console (T-205)', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    router.reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is titled for what it is', () => {
    expect(metadata.title).toBe(t('holds.title'));
  });

  describe('the list', () => {
    it('shows holds in force by default: the record in full, why, who placed it and when, and a release named for it', async () => {
      listed('status=ACTIVE', page([hold()]));
      await show();
      const [card] = cards() as [HTMLElement];
      expect(card).toHaveTextContent(t('holds.item.in_force'));
      expect(card).toHaveTextContent(t('holds.resource.USER'));
      expect(card).toHaveTextContent(ACCOUNT);
      expect(card).toHaveTextContent(REASON);
      // 06:00 UTC is 10:00 in Yerevan, the reader's own zone; the placer by a short handle.
      expect(card).toHaveTextContent(/Placed Oct 5, 2026, 10:00.* by a1b2c3d4/);
      expect(
        within(card).getByRole('button', {
          name: `${t('hold.release.open')} — ${t('holds.resource.USER')} e18bbb58`,
        }),
      ).toBeInTheDocument();
      expect(
        within(statusNav())
          .getAllByRole('link')
          .map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]),
      ).toEqual([
        [t('holds.status.ACTIVE'), '/legal-holds', 'page'],
        [t('holds.status.RELEASED'), '/legal-holds?status=RELEASED', null],
        [t('holds.status.ALL'), '/legal-holds?status=ALL', null],
      ]);
      expect(screen.queryByRole('link', { name: t('holds.next') })).toBeNull();
    });

    it('shows a released hold with who released it, when and why — and offers no release', async () => {
      listed('status=RELEASED', page([released]));
      await show({ status: 'RELEASED' });
      const [card] = cards() as [HTMLElement];
      expect(card).toHaveTextContent(t('holds.item.released'));
      expect(card).toHaveTextContent(t('holds.resource.MISSION'));
      expect(card).toHaveTextContent(/Released Oct 5, 2026, 12:30.* by f9e8d7c6/);
      expect(card).toHaveTextContent(RELEASE);
      expect(within(card).queryByRole('button')).toBeNull();
      expect(
        within(statusNav()).getByRole('link', { name: t('holds.status.RELEASED') }),
      ).toHaveAttribute('aria-current', 'page');
    });

    it('reads a status it does not know as the default', async () => {
      listed('status=ACTIVE', page([]));
      await show({ status: 'OPEN' });
      expect(listCalls()).toEqual(['/legal-holds?status=ACTIVE']);
    });

    it.each([
      ['ACTIVE', {}],
      ['RELEASED', { status: 'RELEASED' }],
      ['ALL', { status: 'ALL' }],
    ] as const)('says when there is nothing %s', async (status, params) => {
      listed(`status=${status}`, page([]));
      await show(params);
      expect(screen.getByText(t('holds.empty.title'))).toBeInTheDocument();
      expect(screen.getByText(t(`holds.empty.body.${status}`))).toBeInTheDocument();
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('pages on, keeping the view, and back to the newest', async () => {
      listed('status=ALL&cursor=c%2F2', page([hold()], 'c/3'));
      await show({ status: 'ALL', cursor: 'c/2' });
      expect(screen.getByRole('link', { name: t('holds.next') })).toHaveAttribute(
        'href',
        '/legal-holds?status=ALL&cursor=c%2F3',
      );
      expect(screen.getByRole('link', { name: t('holds.first') })).toHaveAttribute(
        'href',
        '/legal-holds?status=ALL',
      );
    });

    it('says what is missing to staff without the COMPLIANCE scope — the API refused', async () => {
      api.on('GET /legal-holds?status=ACTIVE', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      await show();
      expect(screen.getByText(t('holds.no_scope.title'))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t('hold.place.open') })).toBeNull();
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('starts again from the newest, in the same view, when a cursor no longer fits', async () => {
      api.on(
        `GET /legal-holds?status=ALL&resourceType=USER&resourceId=${ACCOUNT}&cursor=old`,
        400,
        apiError('VALIDATION_FAILED', 'error.validation.cursor.invalid'),
      );
      await expect(
        show({ status: 'ALL', resourceType: 'USER', resourceId: ACCOUNT, cursor: 'old' }),
      ).rejects.toEqual(
        new Redirected(`/legal-holds?status=ALL&resourceType=USER&resourceId=${ACCOUNT}`),
      );
    });

    it('fails loudly on anything else', async () => {
      api.on(
        'GET /legal-holds?status=ACTIVE',
        400,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
      );
      await expect(show()).rejects.toMatchObject({ status: 400 });
      api.on('GET /legal-holds?status=ACTIVE', 500, apiError('INTERNAL', 'error.common.internal'));
      await expect(show()).rejects.toMatchObject({ status: 500 });
      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
      await expect(show()).rejects.toThrow('network down');
    });
  });

  describe('holds on one record', () => {
    it('narrows to the record looked up, says which, and offers the way back to every record', async () => {
      listed(`status=ACTIVE&resourceType=USER&resourceId=${ACCOUNT}`, page([hold()]));
      // Pasted in capitals, with spaces: still the record.
      await show({ resourceType: 'USER', resourceId: ` ${ACCOUNT.toUpperCase()} ` });
      expect(
        screen.getByText(t('holds.find.showing', { type: t('holds.resource.USER'), id: ACCOUNT })),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: t('holds.find.clear') })).toHaveAttribute(
        'href',
        '/legal-holds',
      );
      // The status links keep the record.
      expect(
        within(statusNav()).getByRole('link', { name: t('holds.status.ALL') }),
      ).toHaveAttribute('href', `/legal-holds?status=ALL&resourceType=USER&resourceId=${ACCOUNT}`);
      // The lookup form keeps what was asked, and the status.
      expect(screen.getByRole('combobox', { name: t('holds.find.type') })).toHaveValue('USER');
      expect(screen.getByRole('textbox', { name: t('holds.find.id') })).not.toHaveAttribute(
        'aria-invalid',
      );
    });

    it('says when the record has no holds of the kind shown, and keeps the status in the lookup', async () => {
      listed(`status=RELEASED&resourceType=MISSION&resourceId=${MISSION}`, page([]));
      const { container } = await show({
        status: 'RELEASED',
        resourceType: 'MISSION',
        resourceId: MISSION,
      });
      expect(screen.getByText(t('holds.empty.record'))).toBeInTheDocument();
      expect(container.querySelector('input[type="hidden"][name="status"]')).toHaveValue(
        'RELEASED',
      );
    });

    it.each([
      ['an id that is not one', { resourceType: 'USER', resourceId: 'e18bbb58' }],
      ['a kind it does not know', { resourceType: 'EVIDENCE', resourceId: ACCOUNT }],
      ['an id with no kind', { resourceId: ACCOUNT }],
      ['a kind with no id', { resourceType: 'USER', resourceId: '  ' }],
    ])('says so, and does not narrow the list, for %s', async (_, params) => {
      listed('status=ACTIVE', page([hold()]));
      await show(params);
      expect(listCalls()).toEqual(['/legal-holds?status=ACTIVE']);
      const id = screen.getByRole('textbox', { name: t('holds.find.id') });
      expect(id).toHaveAttribute('aria-invalid', 'true');
      expect(id).toHaveAccessibleDescription(t('holds.find.invalid'));
      // Nothing says it is showing one record's holds.
      expect(screen.queryByRole('link', { name: t('holds.find.clear') })).toBeNull();
    });
  });

  describe('placing a hold', () => {
    const open = async () => {
      await user().click(screen.getByRole('button', { name: t('hold.place.open') }));
      return screen.findByRole('dialog', { name: t('hold.place.title') });
    };

    it('keeps the control disabled until a kind, an id and a reason as long as the API requires', async () => {
      listed('status=ACTIVE', page([]));
      await show();
      const sheet = await open();
      const submit = within(sheet).getByRole('button', { name: t('hold.place.submit') });
      expect(
        within(sheet).getByRole('textbox', { name: t('hold.place.reason') }),
      ).toHaveAccessibleDescription(t('hold.place.reason_hint'));
      expect(within(sheet).getByRole('textbox', { name: t('hold.place.id') })).toHaveValue('');
      expect(
        within(sheet)
          .getAllByRole('radio')
          .every((r) => !(r as HTMLInputElement).checked),
      ).toBe(true);

      await user().click(within(sheet).getByRole('radio', { name: t('holds.resource.TENANT') }));
      await paste(within(sheet).getByRole('textbox', { name: t('hold.place.id') }), ACCOUNT);
      await paste(
        within(sheet).getByRole('textbox', { name: t('hold.place.reason') }),
        ' '.repeat(12) + 'x'.repeat(11),
      );
      expect(submit).toBeDisabled();
      await user().type(within(sheet).getByRole('textbox', { name: t('hold.place.reason') }), 'x');
      expect(submit).toBeEnabled();
    });

    it('places it, trimmed, then reads the page again', async () => {
      listed('status=ACTIVE', page([]));
      await show();
      api.on('POST /legal-holds', 201, hold());
      const sheet = await open();
      await user().click(within(sheet).getByRole('radio', { name: t('holds.resource.USER') }));
      await paste(within(sheet).getByRole('textbox', { name: t('hold.place.id') }), ` ${ACCOUNT} `);
      await paste(
        within(sheet).getByRole('textbox', { name: t('hold.place.reason') }),
        `  ${REASON}  `,
      );
      await user().click(within(sheet).getByRole('button', { name: t('hold.place.submit') }));
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(api.calls.at(-1)).toMatchObject({
        method: 'POST',
        path: '/legal-holds',
        origin: '',
        body: { resourceType: 'USER', resourceId: ACCOUNT, reason: REASON },
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      // The next hold is usually on another record: the sheet starts afresh.
      const again = await open();
      expect(within(again).getByRole('textbox', { name: t('hold.place.id') })).toHaveValue('');
      expect(within(again).getByRole('textbox', { name: t('hold.place.reason') })).toHaveValue('');
      expect(
        within(again)
          .getAllByRole('radio')
          .every((r) => !(r as HTMLInputElement).checked),
      ).toBe(true);
    });

    it('starts from the record looked up', async () => {
      listed(`status=ACTIVE&resourceType=MISSION&resourceId=${MISSION}`, page([]));
      await show({ resourceType: 'MISSION', resourceId: MISSION });
      const sheet = await open();
      expect(within(sheet).getByRole('radio', { name: t('holds.resource.MISSION') })).toBeChecked();
      expect(within(sheet).getByRole('textbox', { name: t('hold.place.id') })).toHaveValue(MISSION);
    });

    it('says in words when no record of that kind has that id, and stays open', async () => {
      listed(`status=ACTIVE&resourceType=MISSION&resourceId=${MISSION}`, page([]));
      await show({ resourceType: 'MISSION', resourceId: MISSION });
      api.on('POST /legal-holds', 404, apiError('NOT_FOUND', 'error.common.not_found'));
      const sheet = await open();
      await paste(within(sheet).getByRole('textbox', { name: t('hold.place.reason') }), REASON);
      await user().click(within(sheet).getByRole('button', { name: t('hold.place.submit') }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(t('hold.place.not_found'));
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('opens from the side from tablet width, and closes on Cancel without sending', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: true,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      listed('status=ACTIVE', page([]));
      await show();
      const sheet = await open();
      expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'right');
      await user().click(within(sheet).getByRole('button', { name: t('hold.cancel') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    });
  });

  describe('releasing a hold', () => {
    const open = async () => {
      await user().click(
        screen.getByRole('button', { name: new RegExp(`^${t('hold.release.open')} — `) }),
      );
      return screen.findByRole('dialog', { name: t('hold.release.title') });
    };

    it('says it cannot be undone, and waits for a reason as long as the API requires', async () => {
      listed('status=ACTIVE', page([hold()]));
      await show();
      const sheet = await open();
      expect(sheet).toHaveAccessibleDescription(t('hold.release.description'));
      const submit = within(sheet).getByRole('button', { name: t('hold.release.submit') });
      expect(submit).toBeDisabled();
      await user().type(
        within(sheet).getByRole('textbox', { name: t('hold.release.reason') }),
        'x'.repeat(11),
      );
      expect(submit).toBeDisabled();
      await user().type(
        within(sheet).getByRole('textbox', { name: t('hold.release.reason') }),
        'x',
      );
      expect(submit).toBeEnabled();
    });

    it('releases it with the reason, trimmed, then reads the page again', async () => {
      listed('status=ACTIVE', page([hold()]));
      await show();
      api.on(`POST /legal-holds/${HOLD}/release`, 200, released);
      const sheet = await open();
      await paste(
        within(sheet).getByRole('textbox', { name: t('hold.release.reason') }),
        ` ${RELEASE} `,
      );
      await user().click(within(sheet).getByRole('button', { name: t('hold.release.submit') }));
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(api.calls.at(-1)).toMatchObject({
        method: 'POST',
        path: `/legal-holds/${HOLD}/release`,
        body: { reason: RELEASE },
      });
    });

    it('opens from the side from tablet width, and closes on Cancel without sending', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: true,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      listed('status=ACTIVE', page([hold()]));
      await show();
      const sheet = await open();
      expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'right');
      await user().click(within(sheet).getByRole('button', { name: t('hold.cancel') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('says someone released it first, and stays open', async () => {
      listed('status=ACTIVE', page([hold()]));
      await show();
      api.on(
        `POST /legal-holds/${HOLD}/release`,
        409,
        apiError('STATE_CONFLICT', 'error.common.state_conflict'),
      );
      const sheet = await open();
      await paste(within(sheet).getByRole('textbox', { name: t('hold.release.reason') }), RELEASE);
      await user().click(within(sheet).getByRole('button', { name: t('hold.release.submit') }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(t('hold.release.conflict'));
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });
});
