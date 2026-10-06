import { catalogs } from '@investigator/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiMessage } from '@/lib/api/assistant';
import { newestFirst, Opener, OPENER, viewport } from '@/test/assistant';
import { api, apiError } from '@/test/api';
import { aiMessage, aiSession } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { AssistantDeepLink } from './assistant-deep-link';
import { AssistantPanel } from './assistant-panel';
import { AssistantProvider } from './assistant-provider';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.assistant;
const FAILED = aiSession({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Field team' });
const LATER = aiSession({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Quote validity' });
const messagesOf = (id: string) => `GET /ai/sessions/${id}/messages?order=newest&limit=30`;
const outcome: AiMessage = aiMessage({
  id: 'm2',
  sequence: 2,
  role: 'SYSTEM',
  kind: 'PLAN_OUTCOME',
  content: null,
  event: {
    planId: 'p1',
    outcome: 'partial',
    status: 'FAILED',
    reason: 'step_failed',
    steps: [
      { ordinal: 1, tool: 'createTeam', status: 'DONE', error: null },
      { ordinal: 2, tool: 'inviteMember', status: 'FAILED', error: 'forbidden' },
    ],
  } as unknown as AiMessage['event'],
});

/** The assistant as the workspace layout mounts it: the reader of the address beside the panel. */
const tree = (confirmFirst?: ReactNode) => (
  <AssistantProvider audience="CUSTOMER" confirmFirst={confirmFirst}>
    <AssistantDeepLink />
    <Opener />
    <AssistantPanel />
  </AssistantProvider>
);
/** The app at `path`, as a link — a notification's — leads there. */
const at = (path: string) => {
  const url = new URL(path, 'http://localhost');
  router.pathname = url.pathname;
  router.search = url.search;
};

describe('opening the assistant on the conversation a link names (T-231)', () => {
  beforeEach(() => {
    router.reset();
    api.install();
    api.on('GET /workspaces', 200, [{ id: 'w1', kind: 'PERSONAL', name: null, current: true }]);
    viewport(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens that conversation at its end, with the plan’s outcome, and drops the parameter', async () => {
    api.on(`GET /ai/sessions/${FAILED.id}`, 200, FAILED);
    api.on(messagesOf(FAILED.id), 200, newestFirst([aiMessage(), outcome]));
    at(`/?assistant=${FAILED.id}`);
    renderIntl(tree());

    expect(await screen.findByRole('heading', { name: FAILED.title! })).toBeInTheDocument();
    const log = await screen.findByRole('log');
    expect(within(log).getByText(en.outcome.partial)).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith('/', { scroll: false });
    // Opened as if chosen from the list: not the latest conversation, which is never read.
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).not.toContain('GET /ai/sessions?limit=1');
  });

  it('keeps the rest of the address as it was', async () => {
    api.on(`GET /ai/sessions/${FAILED.id}`, 200, FAILED);
    api.on(messagesOf(FAILED.id), 200, newestFirst([aiMessage()]));
    at(`/missions?status=open&assistant=${FAILED.id}`);
    renderIntl(tree());
    await screen.findByRole('heading', { name: FAILED.title! });
    expect(router.replace).toHaveBeenCalledWith('/missions?status=open', { scroll: false });
  });

  it('opens a conversation the link names while another is open, as a link followed in the app', async () => {
    api.on('GET /ai/sessions?limit=1', 200, {
      items: [LATER],
      pageInfo: { nextCursor: null, hasNextPage: false },
    });
    api.on(messagesOf(LATER.id), 200, newestFirst([aiMessage()]));
    const { rerender } = renderIntl(tree());
    await userEvent.click(screen.getByRole('button', { name: OPENER }));
    await screen.findByRole('heading', { name: LATER.title! });

    api.on(`GET /ai/sessions/${FAILED.id}`, 200, FAILED);
    api.on(messagesOf(FAILED.id), 200, newestFirst([aiMessage(), outcome]));
    at(`/?assistant=${FAILED.id}`);
    rerender(tree());
    expect(await screen.findByRole('heading', { name: FAILED.title! })).toBeInTheDocument();

    // The parameter gone from the address, a render is not a second opening.
    at('/');
    rerender(tree());
    at(`/?assistant=${FAILED.id}`);
    rerender(tree());
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(2));
    expect(
      api.calls.filter((c) => c.path === `/ai/sessions/${FAILED.id}`).map((c) => c.method),
    ).toEqual(['GET', 'GET']);
    // The same address rendered again, unchanged, opens nothing more.
    rerender(tree());
    expect(api.calls.filter((c) => c.path === `/ai/sessions/${FAILED.id}`)).toHaveLength(2);
  });

  it('says a conversation that is gone, or not the reader’s, is no longer available', async () => {
    api.on(`GET /ai/sessions/${FAILED.id}`, 404, apiError('NOT_FOUND', 'error.common.not_found'));
    at(`/?assistant=${FAILED.id}`);
    renderIntl(tree());
    expect(await screen.findByText(en.notice.gone)).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith('/', { scroll: false });
  });

  it('offers to try again when the conversation could not be read, and reads that one again', async () => {
    api.on(
      `GET /ai/sessions/${FAILED.id}`,
      500,
      apiError('INTERNAL_ERROR', 'error.common.internal'),
    );
    at(`/?assistant=${FAILED.id}`);
    renderIntl(tree());
    expect(await screen.findByText(en.load.failed)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: en.turn.retry });
    api.on(`GET /ai/sessions/${FAILED.id}`, 200, FAILED);
    api.on(messagesOf(FAILED.id), 200, newestFirst([aiMessage(), outcome]));
    await userEvent.click(retry);
    expect(await screen.findByRole('heading', { name: FAILED.title! })).toBeInTheDocument();
  });

  it.each([
    [200, FAILED],
    [404, apiError('NOT_FOUND', 'error.common.not_found')],
  ])('ignores a first link’s late %s once a second link was followed', async (status, body) => {
    const release = api.hold(`GET /ai/sessions/${FAILED.id}`, status, body);
    at(`/?assistant=${FAILED.id}`);
    const { rerender } = renderIntl(tree());
    await waitFor(() =>
      expect(api.calls.map((c) => c.path)).toContain(`/ai/sessions/${FAILED.id}`),
    );

    api.on(`GET /ai/sessions/${LATER.id}`, 200, LATER);
    api.on(messagesOf(LATER.id), 200, newestFirst([aiMessage()]));
    at(`/?assistant=${LATER.id}`);
    rerender(tree());
    await screen.findByRole('heading', { name: LATER.title! });

    // What arrives for the first link now is late: the second stays open, and nothing says "gone".
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByRole('heading', { name: LATER.title! })).toBeInTheDocument();
    expect(screen.queryByText(en.notice.gone)).toBeNull();
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).not.toContain(messagesOf(FAILED.id));
  });

  it('drops a parameter that is not a conversation, and opens nothing', async () => {
    at('/?assistant=not-a-conversation');
    renderIntl(tree());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/', { scroll: false }));
    expect(screen.queryByRole('log')).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it('does nothing without the parameter', async () => {
    renderIntl(tree());
    expect(router.replace).not.toHaveBeenCalled();
    expect(api.calls).toEqual([]);
  });

  it('opens the panel on how to confirm the address, and reads nothing, while it is unconfirmed', async () => {
    at(`/?assistant=${FAILED.id}`);
    renderIntl(tree(<p>Confirm your address first</p>));
    expect(await screen.findByText('Confirm your address first')).toBeInTheDocument();
    expect(api.calls).toEqual([]);
  });
});
