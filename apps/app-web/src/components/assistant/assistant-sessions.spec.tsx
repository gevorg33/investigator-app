import { catalogs } from '@investigator/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiMessage } from '@/lib/api/assistant';
import { newestFirst, openAssistant, viewport } from '@/test/assistant';
import { api, apiError } from '@/test/api';
import { aiMessage, aiReply, aiSession, emptyPage } from '@/test/fixtures';
import { SEARCH_DELAY_MS } from './session-list';

const en = catalogs.en.assistant;
const A = aiSession({ id: '00000000-0000-4000-8000-0000000000aa', title: 'Quote validity' });
const B = aiSession({
  id: '00000000-0000-4000-8000-0000000000bb',
  title: 'Refund question',
  status: 'IDLE',
  lastActivityAt: '2026-09-24T10:00:00.000Z',
});
const ARCHIVED = aiSession({
  id: '00000000-0000-4000-8000-0000000000cc',
  title: 'Old matter',
  status: 'ARCHIVED',
});
const LATEST = 'GET /ai/sessions?limit=1';
const CURRENT = 'GET /ai/sessions?archived=false&limit=20';
const ARCHIVED_LIST = 'GET /ai/sessions?archived=true&limit=20';
const newest = (id: string, cursor?: string) =>
  `GET /ai/sessions/${id}/messages?order=newest&limit=30${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
const gone = apiError('NOT_FOUND', 'error.common.not_found');

/** Messages `from`..`to` of a conversation: the person asks on odd numbers, the assistant answers. */
const span = (from: number, to: number): AiMessage[] =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const sequence = from + i;
    return sequence % 2 === 1
      ? aiMessage({ id: `q${sequence}`, sequence, content: `Question ${sequence}` })
      : aiReply({ id: `a${sequence}`, sequence, content: `Answer ${sequence}` });
  });

const log = () => screen.getByRole('log');
const entries = () => [...log().children] as HTMLElement[];
const openList = async () => {
  await userEvent.click(await screen.findByRole('button', { name: en.sessions.open }));
  return screen.findByRole('heading', { name: en.sessions.title });
};
const menu = async (item: string) => {
  await userEvent.click(screen.getByRole('button', { name: en.actions.menu }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
};

/** The assistant opened on conversation A (its newest page), A and B in the current list. */
const onA = async (messages = span(1, 2), earlier: string | null = null) => {
  api.on(LATEST, 200, { ...emptyPage, items: [A] });
  api.on(newest(A.id), 200, newestFirst(messages, earlier));
  api.on(CURRENT, 200, { ...emptyPage, items: [A, B] });
  await openAssistant();
  await screen.findByRole('heading', { name: A.title! });
};

describe('conversations — the list and what can be done with one (T-057)', () => {
  beforeEach(() => {
    api.install();
    api.on('GET /workspaces', 200, [{ id: 'w1', kind: 'PERSONAL', name: null, current: true }]);
    viewport(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('the list', () => {
    it('opens in place of the conversation — inside the sheet on a phone — and focus goes with it', async () => {
      await onA();
      await openList();
      const sheet = screen.getByRole('dialog');
      expect(within(sheet).getByRole('heading', { name: en.sessions.title })).toBeInTheDocument();
      expect(screen.queryByRole('log')).toBeNull();
      expect(screen.getByRole('button', { name: en.sessions.back })).toHaveFocus();

      const rows = await within(sheet).findAllByRole('button', { name: /Quote validity|Refund/ });
      expect(rows.map((r) => r.textContent)).toEqual([
        `Quote validity${en.sessions.here}`,
        // Relative to now, in the reader's language.
        expect.stringMatching(/^Refund question(yesterday|.+ ago)$/),
      ]);
      // The one open now is marked for assistive technology, and in words — not colour alone.
      expect(rows[0]).toHaveAttribute('aria-current', 'true');
      expect(rows[1]).not.toHaveAttribute('aria-current');

      await userEvent.click(screen.getByRole('button', { name: en.sessions.back }));
      expect(await screen.findByRole('log')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: en.composer.label })).toHaveFocus();
    });

    it('docks with the panel on a desktop, in the same place', async () => {
      viewport(true);
      await onA();
      await openList();
      expect(
        within(screen.getByRole('complementary')).getByRole('heading', { name: en.sessions.title }),
      ).toBeInTheDocument();
    });

    it('shows the archive on request, a page at a time, and says when a shelf is empty', async () => {
      await onA();
      api.on(ARCHIVED_LIST, 200, {
        items: [ARCHIVED],
        pageInfo: { nextCursor: 'arch/2', hasNextPage: true },
      });
      api.on(`${ARCHIVED_LIST}&cursor=arch%2F2`, 200, {
        ...emptyPage,
        items: [
          aiSession({
            id: '00000000-0000-4000-8000-0000000000dd',
            title: null,
            status: 'ARCHIVED',
          }),
        ],
      });
      await openList();
      await screen.findByRole('button', { name: /Refund question/ });
      await userEvent.click(screen.getByRole('radio', { name: en.sessions.archived }));
      expect(await screen.findByRole('button', { name: /Old matter/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: en.sessions.more }));
      expect(
        await screen.findByRole('button', { name: new RegExp(en.sessions.untitled) }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.sessions.more })).toBeNull();

      // Choosing the chosen shelf again changes nothing.
      await userEvent.click(screen.getByRole('radio', { name: en.sessions.archived }));
      expect(screen.getByRole('radio', { name: en.sessions.archived })).toBeChecked();

      api.on(ARCHIVED_LIST, 200, emptyPage);
      await userEvent.click(screen.getByRole('radio', { name: en.sessions.current }));
      await userEvent.click(screen.getByRole('radio', { name: en.sessions.archived }));
      expect(await screen.findByText(en.sessions.empty_archived)).toBeInTheDocument();
    });

    it('teaches an empty list, and says when it cannot be read — with a way to try again', async () => {
      api.on(LATEST, 200, emptyPage);
      api.on(CURRENT, 200, emptyPage);
      await openAssistant();
      await openList();
      expect(await screen.findByText(en.sessions.empty_current)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: en.sessions.back }));
      api.on(CURRENT, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openList();
      expect(await screen.findByText(en.sessions.failed)).toBeInTheDocument();
      api.on(CURRENT, 200, { ...emptyPage, items: [A] });
      await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
      expect(await screen.findByRole('button', { name: /Quote validity/ })).toBeInTheDocument();
    });

    it('keeps what it has and says so when the next page cannot be read', async () => {
      await onA();
      api.on(CURRENT, 200, { items: [A], pageInfo: { nextCursor: 'cur/2', hasNextPage: true } });
      api.on(`${CURRENT}&cursor=cur%2F2`, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openList();
      await userEvent.click(await screen.findByRole('button', { name: en.sessions.more }));
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
      expect(screen.getByRole('button', { name: /Quote validity/ })).toBeInTheDocument();
    });

    it('returns to the conversation already open without reading it again', async () => {
      await onA();
      await openList();
      await userEvent.click(await screen.findByRole('button', { name: /Quote validity/ }));
      await screen.findByRole('log');
      expect(api.calls.filter((c) => c.path.includes('/messages'))).toHaveLength(1);
    });
  });

  describe('opening a conversation — its end, never its whole history', () => {
    it('opens another at its newest page, and reaches back a page at a time, keeping the reader’s place', async () => {
      await onA();
      api.on(newest(B.id), 200, newestFirst(span(31, 60), 'b/31'));
      api.on(newest(B.id, 'b/31'), 200, newestFirst(span(1, 30)));
      await openList();
      await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
      await screen.findByRole('dialog', { name: B.title! });
      expect(entries()).toHaveLength(30);
      expect(entries()[0]).toHaveTextContent('Question 31');

      // The earlier page lands above; the reader stays where they were.
      const scroller = log().closest('.overflow-y-auto')!;
      const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(3000);
      scroller.scrollTop = 40;
      await userEvent.click(screen.getByRole('button', { name: en.earlier }));
      await waitFor(() => expect(entries()).toHaveLength(60));
      expect(entries()[0]).toHaveTextContent('Question 1');
      expect(screen.queryByRole('button', { name: en.earlier })).toBeNull();
      height.mockRestore();
    });

    it('says when earlier messages cannot be read, and tries again', async () => {
      await onA();
      api.on(newest(B.id), 200, newestFirst(span(31, 60), 'b/31'));
      api.on(newest(B.id, 'b/31'), 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openList();
      await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
      await userEvent.click(await screen.findByRole('button', { name: en.earlier }));
      const again = await screen.findByRole('button', { name: en.earlier_failed });
      api.on(newest(B.id, 'b/31'), 200, newestFirst(span(1, 30)));
      await userEvent.click(again);
      await waitFor(() => expect(entries()).toHaveLength(60));
    });

    it('says when it cannot open one, and tries that one again', async () => {
      await onA();
      api.on(newest(B.id), 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openList();
      await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
      expect(await screen.findByText(en.load.failed)).toBeInTheDocument();
      api.on(newest(B.id), 200, newestFirst(span(1, 2)));
      await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
      expect(await screen.findByRole('dialog', { name: B.title! })).toBeInTheDocument();
    });

    it('takes the reader’s choice over a first opening still on its way', async () => {
      const release = api.hold(LATEST, 200, { ...emptyPage, items: [A] });
      api.on(newest(A.id), 200, newestFirst(span(1, 2)));
      api.on(CURRENT, 200, { ...emptyPage, items: [A, B] });
      api.on(newest(B.id), 200, newestFirst(span(1, 4)));
      await openAssistant();
      await openList();
      await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
      await screen.findByRole('dialog', { name: B.title! });
      release();
      await act(async () => undefined);
      expect(screen.getByRole('dialog', { name: B.title! })).toBeInTheDocument();
      expect(entries()).toHaveLength(4);
    });
  });

  describe('search', () => {
    it('waits for two characters and a pause, then finds by name or by what was said', async () => {
      await onA();
      await openList();
      await screen.findByRole('button', { name: /Refund question/ });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const box = screen.getByRole('searchbox', { name: en.sessions.search });
      api.on('GET /ai/sessions/search?q=re', 200, [{ ...B, firstMatchSequence: null }]);
      await userEvent.type(box, 'r');
      await act(async () => void vi.advanceTimersByTime(SEARCH_DELAY_MS));
      expect(api.calls.some((c) => c.path.startsWith('/ai/sessions/search'))).toBe(false);
      await userEvent.type(box, 'e');
      // The shelves step aside while searching; the results take the list's place.
      expect(screen.queryByRole('radio', { name: en.sessions.archived })).toBeNull();
      await act(async () => void vi.advanceTimersByTime(SEARCH_DELAY_MS));
      expect(await screen.findByRole('button', { name: /Refund question/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Quote validity/ })).toBeNull();

      api.on('GET /ai/sessions/search?q=zzz', 200, []);
      await userEvent.clear(box);
      await userEvent.type(box, 'zzz');
      await act(async () => void vi.advanceTimersByTime(SEARCH_DELAY_MS));
      expect(await screen.findByText('No conversation mentions “zzz”.')).toBeInTheDocument();
      // Only the searches that were waited for were sent.
      expect(
        api.calls.filter((c) => c.path.startsWith('/ai/sessions/search')).map((c) => c.path),
      ).toEqual(['/ai/sessions/search?q=re', '/ai/sessions/search?q=zzz']);
    });

    /** Waits for the results to replace the list — the list's row opens without a match. */
    const results = () =>
      waitFor(() => expect(screen.queryByRole('button', { name: /Quote validity/ })).toBeNull(), {
        timeout: 2000,
      });

    it('opens a match where it was said — reaching back only as far as that — and marks it', async () => {
      await onA();
      api.on('GET /ai/sessions/search?q=chargeback', 200, [{ ...B, firstMatchSequence: 12 }]);
      api.on(newest(B.id), 200, newestFirst(span(61, 90), 'b/61'));
      api.on(newest(B.id, 'b/61'), 200, newestFirst(span(31, 60), 'b/31'));
      api.on(newest(B.id, 'b/31'), 200, newestFirst(span(1, 30), null));
      const into = vi.fn();
      Element.prototype.scrollIntoView = into;
      await openList();
      await userEvent.type(
        screen.getByRole('searchbox', { name: en.sessions.search }),
        'chargeback',
      );
      await results();
      await userEvent.click(screen.getByRole('button', { name: /Refund question/ }));
      await screen.findByRole('dialog', { name: B.title! });
      expect(entries()).toHaveLength(90);
      const match = entries().find((e) => e.dataset['sequence'] === '12')!;
      expect(match).toHaveClass('bg-primary-subtle');
      expect(into).toHaveBeenCalledWith({ block: 'center' });
      expect(into.mock.contexts[0]).toBe(match);
    });

    it('stops reaching back after ten pages, however far the match is', async () => {
      await onA();
      api.on('GET /ai/sessions/search?q=ancient', 200, [{ ...B, firstMatchSequence: 1 }]);
      api.on(newest(B.id), 200, newestFirst(span(999, 1000), 'b/999'));
      // Every earlier page points further back still.
      for (let n = 0; n < 12; n++) {
        const top = 999 - n * 2;
        api.on(newest(B.id, `b/${top}`), 200, newestFirst(span(top - 2, top - 1), `b/${top - 2}`));
      }
      await openList();
      await userEvent.type(screen.getByRole('searchbox', { name: en.sessions.search }), 'ancient');
      await results();
      await userEvent.click(screen.getByRole('button', { name: /Refund question/ }));
      await screen.findByRole('dialog', { name: B.title! });
      expect(api.calls.filter((c) => c.path.includes(`/${B.id}/messages`))).toHaveLength(11);
      expect(screen.getByRole('button', { name: en.earlier })).toBeInTheDocument();
    });
  });

  describe('rename, archive, delete', () => {
    it('renames in place — Escape keeps the old name, an unchanged name sends nothing', async () => {
      await onA();
      await menu(en.actions.rename);
      const field = screen.getByRole('textbox', { name: en.actions.name });
      expect(field).toHaveValue('Quote validity');
      expect(field).toHaveFocus();
      await userEvent.keyboard('{Escape}');
      // Escape leaves the name, not the assistant.
      expect(screen.getByRole('dialog', { name: A.title! })).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: en.actions.name })).toBeNull();

      await menu(en.actions.rename);
      await userEvent.click(screen.getByRole('button', { name: en.actions.save }));
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);

      await menu(en.actions.rename);
      await userEvent.click(screen.getByRole('button', { name: en.actions.cancel }));
      expect(screen.queryByRole('textbox', { name: en.actions.name })).toBeNull();

      api.on(`PATCH /ai/sessions/${A.id}`, 200, { ...A, title: 'Quote deadlines' });
      await menu(en.actions.rename);
      await userEvent.clear(screen.getByRole('textbox', { name: en.actions.name }));
      await userEvent.type(
        screen.getByRole('textbox', { name: en.actions.name }),
        '  Quote deadlines {Enter}',
      );
      expect(await screen.findByRole('dialog', { name: 'Quote deadlines' })).toBeInTheDocument();
      expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        title: 'Quote deadlines',
      });
    });

    it('keeps the form open and says why when a name is refused; an empty name renames nothing', async () => {
      await onA();
      api.on(
        `PATCH /ai/sessions/${A.id}`,
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
      );
      await menu(en.actions.rename);
      const field = screen.getByRole('textbox', { name: en.actions.name });
      await userEvent.clear(field);
      await userEvent.type(field, 'x');
      await userEvent.click(screen.getByRole('button', { name: en.actions.save }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        catalogs.en.error.common.validation_failed,
      );
      expect(screen.getByRole('textbox', { name: en.actions.name })).toBeInTheDocument();

      // Spaces only: nothing sent, the old name kept.
      await userEvent.clear(field);
      await userEvent.type(field, '   ');
      act(() => field.closest('form')!.requestSubmit());
      await waitFor(() =>
        expect(screen.queryByRole('textbox', { name: en.actions.name })).toBeNull(),
      );
      expect(api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    });

    it('archives: the conversation leaves for the archive, a fresh one begins, and it says where it went', async () => {
      await onA();
      api.on(`POST /ai/sessions/${A.id}/archive`, 200, { ...A, status: 'ARCHIVED' });
      await menu(en.actions.archive);
      expect(await screen.findByRole('status')).toHaveTextContent(en.notice.archived);
      expect(screen.getByRole('dialog', { name: en.untitled })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: en.empty.title })).toBeInTheDocument();
    });

    it('opens an archived one marked as archived, and brings it back', async () => {
      await onA();
      api.on(ARCHIVED_LIST, 200, { ...emptyPage, items: [ARCHIVED] });
      api.on(newest(ARCHIVED.id), 200, newestFirst(span(1, 2)));
      api.on(`POST /ai/sessions/${ARCHIVED.id}/resume`, 200, { ...ARCHIVED, status: 'ACTIVE' });
      await openList();
      await userEvent.click(screen.getByRole('radio', { name: en.sessions.archived }));
      await userEvent.click(await screen.findByRole('button', { name: /Old matter/ }));
      await screen.findByRole('dialog', { name: 'Old matter' });
      expect(screen.getByText(en.actions.archived)).toBeInTheDocument();
      await menu(en.actions.restore);
      await waitFor(() => expect(screen.queryByText(en.actions.archived)).toBeNull());
    });

    it('says why an option failed, and keeps the conversation', async () => {
      await onA();
      api.on(
        `POST /ai/sessions/${A.id}/archive`,
        500,
        apiError('INTERNAL_ERROR', 'error.common.internal'),
      );
      await menu(en.actions.archive);
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
      expect(screen.getByRole('dialog', { name: A.title! })).toBeInTheDocument();
    });

    it('asks before deleting — saying what goes with it — and Cancel is where focus starts', async () => {
      await onA();
      await menu(en.actions.delete);
      const confirm = await screen.findByRole('alertdialog', { name: en.delete.title });
      expect(confirm).toHaveTextContent(en.delete.body);
      expect(en.delete.body).toMatch(/anything it keeps/);
      expect(within(confirm).getByRole('button', { name: en.delete.cancel })).toHaveFocus();
      await userEvent.click(within(confirm).getByRole('button', { name: en.delete.cancel }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
      expect(screen.getByRole('button', { name: en.actions.menu })).toHaveFocus();

      api.on(`DELETE /ai/sessions/${A.id}`, 204);
      await menu(en.actions.delete);
      await userEvent.click(await screen.findByRole('button', { name: en.delete.confirm }));
      expect(await screen.findByRole('status')).toHaveTextContent(en.notice.deleted);
      expect(screen.getByRole('dialog', { name: en.untitled })).toBeInTheDocument();
      await waitFor(() =>
        expect(document.activeElement?.outerHTML.slice(0, 160)).toBe(
          screen.getByRole('textbox', { name: en.composer.label }).outerHTML.slice(0, 160),
        ),
      );
    });

    it('says why a delete was refused, keeps the conversation, and gives focus back to its options', async () => {
      await onA();
      api.on(
        `DELETE /ai/sessions/${A.id}`,
        500,
        apiError('INTERNAL_ERROR', 'error.common.internal'),
      );
      await menu(en.actions.delete);
      await userEvent.click(await screen.findByRole('button', { name: en.delete.confirm }));
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
      expect(screen.getByRole('heading', { name: A.title! })).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: en.actions.menu })).toHaveFocus(),
      );
    });

    it('offers no options while an answer forms, and none before there is a conversation', async () => {
      await onA();
      api.stream(`POST /ai/sessions/${A.id}/turns`);
      await userEvent.type(
        screen.getByRole('textbox', { name: en.composer.label }),
        'Still going?',
      );
      await userEvent.click(screen.getByRole('button', { name: en.composer.send }));
      await screen.findByRole('status');
      expect(screen.getByRole('button', { name: en.actions.menu })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: en.new }));
      expect(screen.queryByRole('button', { name: en.actions.menu })).toBeNull();
    });
  });

  describe('whatever finishes after the reader moved on is ignored', () => {
    it.each([
      ['arrives', 200, { ...emptyPage, items: [A] }],
      ['fails', 500, apiError('INTERNAL_ERROR', 'error.common.internal')],
    ] as const)(
      'a first opening that %s after another conversation was chosen',
      async (_l, status, body) => {
        const release = api.hold(LATEST, status, body);
        api.on(newest(A.id), 200, newestFirst(span(1, 6)));
        api.on(CURRENT, 200, { ...emptyPage, items: [A, B] });
        api.on(newest(B.id), 200, newestFirst(span(1, 2)));
        await openAssistant();
        await openList();
        await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
        await screen.findByRole('heading', { name: B.title! });
        release();
        // Long enough for what was released to arrive, and be ignored.
        await act(() => new Promise((r) => setTimeout(r, 50)));
        expect(screen.queryByText(en.load.failed)).toBeNull();
        expect(screen.getByRole('heading', { name: B.title! })).toBeInTheDocument();
        expect(entries()).toHaveLength(2);
      },
    );

    it.each([
      ['arrives', 200, newestFirst(span(1, 8))],
      ['fails', 500, apiError('INTERNAL_ERROR', 'error.common.internal')],
    ] as const)(
      'an opening that %s after the reader chose another',
      async (_label, status, body) => {
        await onA();
        const release = api.hold(newest(B.id), status, body);
        await openList();
        await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
        await openList();
        api.on(newest(A.id), 200, newestFirst(span(1, 2)));
        // B is the one open now, still on its way; choosing A again reads A afresh.
        await userEvent.click(await screen.findByRole('button', { name: /Quote validity/ }));
        await screen.findByRole('heading', { name: A.title! });
        release();
        // Long enough for what was released to arrive, and be ignored.
        await act(() => new Promise((r) => setTimeout(r, 50)));
        expect(screen.getByRole('heading', { name: A.title! })).toBeInTheDocument();
        expect(entries()).toHaveLength(2);
        expect(screen.queryByText(en.load.failed)).toBeNull();
      },
    );

    it.each([
      ['arrive', 200, newestFirst(span(1, 30))],
      ['fail', 500, apiError('INTERNAL_ERROR', 'error.common.internal')],
    ] as const)(
      'earlier messages that %s after a new conversation began',
      async (_label, status, body) => {
        await onA(span(31, 60), 'a/31');
        const release = api.hold(newest(A.id, 'a/31'), status, body);
        await userEvent.click(await screen.findByRole('button', { name: en.earlier }));
        await userEvent.click(screen.getByRole('button', { name: en.new }));
        release();
        // Long enough for what was released to arrive, and be ignored.
        await act(() => new Promise((r) => setTimeout(r, 50)));
        expect(screen.getByRole('heading', { name: en.empty.title })).toBeInTheDocument();
        expect(screen.queryByRole('log')).toBeNull();
      },
    );

    it.each([
      ['arrives', 200, { ...emptyPage, items: [A, B] }],
      ['fails', 500, apiError('INTERNAL_ERROR', 'error.common.internal')],
    ] as const)('a list that %s after the reader left it', async (_label, status, body) => {
      await onA();
      const release = api.hold(CURRENT, status, body);
      await openList();
      await userEvent.click(screen.getByRole('button', { name: en.sessions.back }));
      release();
      // Long enough for what was released to arrive, and be ignored.
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(screen.getByRole('log')).toBeInTheDocument();
      expect(screen.queryByText(en.sessions.failed)).toBeNull();
    });
  });

  describe('no answer at all — the connection dropped', () => {
    it('reading the list', async () => {
      await onA();
      api.down(CURRENT);
      await openList();
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    });

    it('changing the conversation', async () => {
      await onA();
      api.down(`POST /ai/sessions/${A.id}/archive`);
      await menu(en.actions.archive);
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    });
  });

  it('renames a conversation that has no name yet, starting from an empty field', async () => {
    api.on(LATEST, 200, { ...emptyPage, items: [{ ...A, title: null }] });
    api.on(newest(A.id), 200, newestFirst(span(1, 2)));
    await openAssistant();
    await screen.findByRole('heading', { name: en.untitled });
    await menu(en.actions.rename);
    expect(screen.getByRole('textbox', { name: en.actions.name })).toHaveValue('');
  });

  describe('someone else’s conversation, by every path the UI has', () => {
    // The API answers a session that is not the caller's exactly as one that does not exist (T-045):
    // 404. Whatever path reaches it, the panel shows nothing of it and starts afresh saying so.
    const expectGone = async () => {
      expect(await screen.findByRole('status')).toHaveTextContent(en.notice.gone);
      expect(screen.queryByRole('log')).toBeNull();
      expect(screen.queryByText(/Question \d|Answer \d/)).toBeNull();
    };

    it('opening it', async () => {
      await onA();
      api.on(newest(B.id), 404, gone);
      await openList();
      await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
      await expectGone();
    });

    it('reaching back into it', async () => {
      await onA();
      await openList();
      api.on(newest(B.id), 200, newestFirst(span(31, 60), 'b/31'));
      api.on(newest(B.id, 'b/31'), 404, gone);
      await userEvent.click(await screen.findByRole('button', { name: /Refund question/ }));
      await userEvent.click(await screen.findByRole('button', { name: en.earlier }));
      await expectGone();
    });

    it.each([
      ['renaming it', 'PATCH', ''],
      ['archiving it', 'POST', '/archive'],
      ['deleting it', 'DELETE', ''],
    ])('%s', async (_label, method, suffix) => {
      await onA();
      api.on(`${method} /ai/sessions/${A.id}${suffix}`, 404, gone);
      if (method === 'PATCH') {
        await menu(en.actions.rename);
        await userEvent.type(
          screen.getByRole('textbox', { name: en.actions.name }),
          ' again{Enter}',
        );
      } else if (method === 'DELETE') {
        await menu(en.actions.delete);
        await userEvent.click(await screen.findByRole('button', { name: en.delete.confirm }));
      } else await menu(en.actions.archive);
      await expectGone();
    });

    it('bringing it back', async () => {
      await onA();
      api.on(ARCHIVED_LIST, 200, { ...emptyPage, items: [ARCHIVED] });
      api.on(newest(ARCHIVED.id), 200, newestFirst(span(1, 2)));
      api.on(`POST /ai/sessions/${ARCHIVED.id}/resume`, 404, gone);
      await openList();
      await userEvent.click(screen.getByRole('radio', { name: en.sessions.archived }));
      await userEvent.click(await screen.findByRole('button', { name: /Old matter/ }));
      await screen.findByRole('dialog', { name: 'Old matter' });
      await menu(en.actions.restore);
      await expectGone();
    });

    it('asking in it', async () => {
      await onA();
      api.on(`POST /ai/sessions/${A.id}/turns`, 404, gone);
      await userEvent.type(
        screen.getByRole('textbox', { name: en.composer.label }),
        'Anyone there?',
      );
      await userEvent.click(screen.getByRole('button', { name: en.composer.send }));
      await expectGone();
    });
  });
});
