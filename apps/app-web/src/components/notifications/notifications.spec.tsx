import { catalogs } from '@investigator/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationView } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { renderIntl } from '@/test/intl';
import { NotificationBell } from './notification-bell';
import { NotificationsProvider } from './notifications-provider';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.notifications;
const ONE = '0b6f3c1e-8f4a-4a52-9d1e-1a2b3c4d5e6f';
const TWO = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const notification = (over: Partial<NotificationView> = {}): NotificationView => ({
  id: ONE,
  kind: 'mission_published',
  subjectType: 'mission',
  subjectId: 'm-1',
  href: '/missions/m-1',
  createdAt: minutesAgo(5),
  readAt: null,
  ...over,
});

const bell = (layout: 'popover' | 'sheet' = 'popover') =>
  renderIntl(
    <NotificationsProvider>
      <NotificationBell layout={layout} />
    </NotificationsProvider>,
  );

/** The bell, once the count has been read — by its name, which carries the count in words. */
const trigger = (count: number) =>
  screen.findByRole('button', {
    name: count === 0 ? 'Notifications' : `Notifications, ${count} unread`,
  });

beforeEach(() => {
  api.install();
});

describe('the unread count on the bell (T-169)', () => {
  it('reads the count when the app loads and shows it on the bell', async () => {
    api.on('GET /notifications/unread', 200, { count: 3 });
    bell();
    const b = await trigger(3);
    // The badge is for the eye; the name already says it, so it is not read twice.
    const badge = within(b).getByText('3');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no badge with nothing unread', async () => {
    api.on('GET /notifications/unread', 200, { count: 0 });
    bell();
    const b = await trigger(0);
    await waitFor(() =>
      expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /notifications/unread']),
    );
    // The icon alone: no badge, and no "0".
    expect(b.textContent).toBe('');
  });

  it('caps what the badge says at 99+, while the name has the real count', async () => {
    api.on('GET /notifications/unread', 200, { count: 140 });
    bell();
    expect(within(await trigger(140)).getByText('99+')).toBeInTheDocument();
  });

  it('shows no count it could not read — never a guess', async () => {
    api.on('GET /notifications/unread', 500, apiError('INTERNAL', 'error.common.internal'));
    bell();
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect((await trigger(0)).textContent).toBe('');
  });

  it('reads it again when the tab comes back into view, not while it is hidden', async () => {
    api.on('GET /notifications/unread', 200, { count: 1 });
    bell();
    await trigger(1);
    api.on('GET /notifications/unread', 200, { count: 4 });
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(api.calls).toHaveLength(1);
    visibility.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await trigger(4);
    visibility.mockRestore();
  });

  it('shows no count when the API answers with nothing', async () => {
    api.on('GET /notifications/unread', 204);
    bell();
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect((await trigger(0)).textContent).toBe('');
  });

  it('cannot be used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderIntl(<NotificationBell layout="popover" />)).toThrow(
      'useUnread outside NotificationsProvider',
    );
  });
});

describe('the notification centre (T-169)', () => {
  const opened = async (
    items: NotificationView[],
    {
      count = items.filter((i) => i.readAt === null).length,
      nextCursor = null as string | null,
    } = {},
    layout: 'popover' | 'sheet' = 'popover',
  ) => {
    api.on('GET /notifications/unread', 200, { count });
    api.on('GET /notifications', 200, { items, nextCursor });
    const u = userEvent.setup();
    bell(layout);
    await u.click(await trigger(count));
    return u;
  };

  it('is read only when opened', async () => {
    api.on('GET /notifications/unread', 200, { count: 0 });
    bell();
    await trigger(0);
    expect(api.calls.map((c) => c.path)).toEqual(['/notifications/unread']);
  });

  it('shows placeholders while it loads, then the list', async () => {
    api.on('GET /notifications/unread', 200, { count: 1 });
    const release = api.hold('GET /notifications', 200, {
      items: [notification()],
      nextCursor: null,
    });
    const u = userEvent.setup();
    bell();
    await u.click(await trigger(1));
    const dialog = screen.getByRole('dialog', { name: en.title });
    expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(dialog.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(within(dialog).queryByRole('status')).toBeNull();
    release();
    expect(await within(dialog).findByRole('link')).toBeInTheDocument();
    expect(dialog.querySelector('[aria-busy="true"]')).toBeNull();
    expect(dialog.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it('lists each by what happened, when, and whether it is read — linking to where it happened', async () => {
    await opened([
      notification(),
      notification({
        id: TWO,
        kind: 'assignment_report_ready',
        href: '/missions/m-2',
        createdAt: minutesAgo(60 * 26),
        readAt: minutesAgo(60),
      }),
    ]);
    const dialog = screen.getByRole('dialog', { name: en.title });
    const [first, second] = await within(dialog).findAllByRole('link');
    expect(first).toHaveAttribute('href', '/missions/m-1');
    expect(first).toHaveTextContent(`${en.kind.mission_published}${en.unread}, 5 minutes ago`);
    expect(within(first!).getByText(en.kind.mission_published)).toHaveClass('font-semibold');
    expect(second).toHaveAttribute('href', '/missions/m-2');
    expect(second).toHaveTextContent(`${en.kind.assignment_report_ready}yesterday`);
    expect(second).not.toHaveTextContent(en.unread);
  });

  it('marks one read as it is opened, lowers the count, and closes', async () => {
    const u = await opened([notification(), notification({ id: TWO })]);
    api.on(`POST /notifications/${ONE}/read`, 204);
    const [first] = await screen.findAllByRole('link');
    await u.click(first!);
    await waitFor(() =>
      expect(api.calls.map((c) => `${c.method} ${c.path}`)).toContain(
        `POST /notifications/${ONE}/read`,
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await trigger(1)).toBeInTheDocument();
  });

  it('does not mark again one already read', async () => {
    const u = await opened([notification({ readAt: minutesAgo(1) })], { count: 0 });
    await u.click(await screen.findByRole('link'));
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reads the count again when marking one did not land', async () => {
    const u = await opened([notification()]);
    api.on(`POST /notifications/${ONE}/read`, 500, apiError('INTERNAL', 'error.common.internal'));
    await u.click(await screen.findByRole('link'));
    // Optimistically 0; the API still says 1, and the bell says what the API says.
    await trigger(1);
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/notifications/unread').length).toBe(3),
    );
  });

  it('marks all read at once', async () => {
    const u = await opened([notification(), notification({ id: TWO })]);
    api.on('POST /notifications/read-all', 204);
    await u.click(await screen.findByRole('button', { name: en.mark_all }));
    const dialog = screen.getByRole('dialog', { name: en.title });
    await waitFor(() => expect(dialog).not.toHaveTextContent(en.unread));
    expect(within(dialog).queryByRole('button', { name: en.mark_all })).toBeNull();
    expect(await trigger(0)).toBeInTheDocument();
  });

  it('says so when marking all fails, and leaves them unread', async () => {
    const u = await opened([notification()]);
    api.on('POST /notifications/read-all', 500, apiError('INTERNAL', 'error.common.internal'));
    await u.click(await screen.findByRole('button', { name: en.mark_all }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    expect(screen.getByRole('link')).toHaveTextContent(en.unread);
    expect(await trigger(1)).toBeInTheDocument();
  });

  it('still offers "mark all" for unread ones on screen when the count could not be read', async () => {
    api.on('GET /notifications/unread', 500, apiError('INTERNAL', 'error.common.internal'));
    api.on('GET /notifications', 200, { items: [notification()], nextCursor: null });
    api.on(`POST /notifications/${ONE}/read`, 204);
    const u = userEvent.setup();
    bell();
    await u.click(await trigger(0));
    expect(await screen.findByRole('button', { name: en.mark_all })).toBeInTheDocument();
    // Opening one leaves an unknown count unknown — no badge appears from a guess.
    await u.click(screen.getByRole('link'));
    expect((await trigger(0)).textContent).toBe('');
  });

  it('offers no "mark all" when everything is read', async () => {
    await opened([notification({ readAt: minutesAgo(1) })], { count: 0 });
    await screen.findByRole('link');
    expect(screen.queryByRole('button', { name: en.mark_all })).toBeNull();
  });

  it('loads older ones a page at a time', async () => {
    const u = await opened([notification()], { nextCursor: 'c/1+' });
    api.on('GET /notifications?cursor=c%2F1%2B', 200, {
      items: [notification({ id: TWO, kind: 'mission_rejected', readAt: minutesAgo(3) })],
      nextCursor: null,
    });
    await u.click(await screen.findByRole('button', { name: en.more }));
    expect(await screen.findByText(en.kind.mission_rejected)).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: en.more })).toBeNull();
  });

  it('keeps the list when an older page fails, and says why', async () => {
    const u = await opened([notification()], { nextCursor: 'c1' });
    api.on('GET /notifications?cursor=c1', 500, apiError('INTERNAL', 'error.common.internal'));
    await u.click(await screen.findByRole('button', { name: en.more }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('says what will appear when there is nothing', async () => {
    await opened([]);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(en.empty.title);
    expect(status).toHaveTextContent(en.empty.body);
    expect(screen.queryByRole('button', { name: en.mark_all })).toBeNull();
  });

  it('treats an empty reply as an empty list', async () => {
    api.on('GET /notifications/unread', 200, { count: 0 });
    api.on('GET /notifications', 204);
    const u = userEvent.setup();
    bell();
    await u.click(await trigger(0));
    expect(await screen.findByRole('status')).toHaveTextContent(en.empty.title);
  });

  it('says it could not load, and tries again when asked', async () => {
    api.on('GET /notifications/unread', 200, { count: 1 });
    api.down('GET /notifications');
    const u = userEvent.setup();
    bell();
    await u.click(await trigger(1));
    expect(await screen.findByText(en.failed)).toBeInTheDocument();
    api.on('GET /notifications', 200, { items: [notification()], nextCursor: null });
    await u.click(screen.getByRole('button', { name: en.retry }));
    expect(await screen.findByRole('link')).toBeInTheDocument();
    expect(screen.queryByText(en.failed)).toBeNull();
  });

  it('refreshes the count with the list, so the bell agrees with what is shown', async () => {
    await opened([notification(), notification({ id: TWO })], { count: 1 });
    await screen.findAllByRole('link');
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/notifications/unread')).toHaveLength(2),
    );
  });

  it('drops a page that arrives after it was closed', async () => {
    api.on('GET /notifications/unread', 200, { count: 1 });
    const release = api.hold('GET /notifications', 200, {
      items: [notification()],
      nextCursor: null,
    });
    const u = userEvent.setup();
    bell();
    await u.click(await trigger(1));
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    release();
    await waitFor(() => expect(api.calls).toHaveLength(2));
    // Closed before it came: the count is not read again for it.
    expect(api.calls.filter((c) => c.path === '/notifications/unread')).toHaveLength(1);
  });

  it('drops a failure that arrives after it was closed', async () => {
    api.on('GET /notifications/unread', 200, { count: 1 });
    let fail!: () => void;
    const failed = new Promise<void>((r) => (fail = r));
    api.routes.set('GET /notifications', async () => {
      await failed;
      throw new TypeError('Failed to fetch');
    });
    const u = userEvent.setup();
    bell();
    await u.click(await trigger(1));
    await u.keyboard('{Escape}');
    fail();
    await act(() => failed);
    // Closed before it failed: nothing is shown for it, and nothing else is asked.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(en.failed)).toBeNull();
    expect(api.calls.map((c) => c.path)).toEqual(['/notifications/unread', '/notifications']);
  });

  it('opens as a sheet on a phone, with a close button', async () => {
    const u = await opened([notification()], {}, 'sheet');
    const sheet = screen.getByRole('dialog', { name: en.title });
    expect(await within(sheet).findByRole('link')).toBeInTheDocument();
    await u.click(within(sheet).getByRole('button', { name: en.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes the sheet when a notification is opened', async () => {
    const u = await opened([notification()], {}, 'sheet');
    api.on(`POST /notifications/${ONE}/read`, 204);
    await u.click(await screen.findByRole('link'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is in the reader’s language', async () => {
    api.on('GET /notifications/unread', 200, { count: 2 });
    api.on('GET /notifications', 200, { items: [notification()], nextCursor: null });
    const u = userEvent.setup();
    renderIntl(
      <NotificationsProvider>
        <NotificationBell layout="popover" />
      </NotificationsProvider>,
      'ru',
    );
    await u.click(await screen.findByRole('button', { name: 'Уведомления, 2 непрочитанных' }));
    expect(
      await screen.findByText(catalogs.ru.notifications.kind.mission_published),
    ).toBeInTheDocument();
  });
});
