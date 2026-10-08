import { catalogs } from '@investigator/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiMessage, Plan, PlanStep } from '@/lib/api/assistant';
import { api, apiError } from '@/test/api';
import { newestFirst, noPlans, openAssistant, viewport } from '@/test/assistant';
import { aiMessage, aiSession, emptyPage } from '@/test/fixtures';
import { POLL_MS } from './use-plans';

const en = catalogs.en.assistant;
const SESSION = aiSession({ title: 'Set up the field team' });
const OTHER = aiSession({ id: '00000000-0000-4000-8000-00000000a0b2', title: 'Quotes' });
const LATEST = 'GET /ai/sessions?limit=1';
const MESSAGES = `GET /ai/sessions/${SESSION.id}/messages?order=newest&limit=30`;
const OPEN = `GET /ai/sessions/${SESSION.id}/plans?open=true`;
const PLAN_ID = '00000000-0000-4000-8000-0000000000c1';
const ONE = `GET /ai/sessions/${SESSION.id}/plans/${PLAN_ID}`;
const CONFIRM = `POST /ai/sessions/${SESSION.id}/plans/${PLAN_ID}/confirm`;
const DECLINE = `POST /ai/sessions/${SESSION.id}/plans/${PLAN_ID}/decline`;
const HASH = 'f'.repeat(64);

const step = (ordinal: number, over: Partial<PlanStep> = {}): PlanStep =>
  ({
    ordinal,
    tool: ordinal === 1 ? 'createTeam' : 'inviteMember',
    arguments:
      ordinal === 1 ? { name: 'Field' } : { email: `m${ordinal}@example.test`, teams: ['Field'] },
    status: 'PENDING',
    result: null,
    error: null,
    ...over,
  }) as PlanStep;

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: PLAN_ID,
  sessionId: SESSION.id,
  planHash: HASH,
  status: 'PROPOSED',
  confirmation: 'PENDING',
  reason: null,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  confirmedAt: null,
  finishedAt: null,
  createdAt: new Date().toISOString(),
  steps: [step(1), step(2)],
  ...over,
});

const outcome = (o: string, reason: string | null = null): AiMessage =>
  aiMessage({
    id: 'o1',
    sequence: 3,
    role: 'SYSTEM',
    kind: 'PLAN_OUTCOME',
    content: null,
    event: {
      planId: PLAN_ID,
      outcome: o,
      status: 'COMPLETED',
      reason,
      steps: [],
    } as unknown as AiMessage['event'],
  });

const QUESTION = aiMessage({ content: 'Create a Field team and invite Ana' });

/** The assistant opened on the conversation, its plans as `open` says. */
const openOn = async (open: Plan[], messages: AiMessage[] = [QUESTION]) => {
  api.on(LATEST, 200, { ...emptyPage, items: [SESSION] });
  api.on(MESSAGES, 200, newestFirst(messages));
  api.on(OPEN, 200, open);
  await openAssistant();
  await screen.findByRole('heading', { name: SESSION.title! });
};
/** A plan's card by its title: waiting (it asks), running (what was confirmed) or past its time. */
const CARD = new RegExp(`^(${en.plan.title}|${en.plan.title_running}|${en.plan.title_expired})$`);
const card = () => screen.findByRole('group', { name: CARD });
const confirmButton = () => screen.getByRole('button', { name: en.plan.confirm });
const declineButton = () => screen.getByRole('button', { name: en.plan.decline });
const calls = (route: string) => {
  const [method, path] = route.split(' ');
  return api.calls.filter((c) => c.method === method && c.path === path);
};

describe('confirming what the assistant will do (T-058)', () => {
  beforeEach(() => {
    api.install();
    api.on('GET /workspaces', 200, [
      { id: 'w1', kind: 'AGENCY', name: 'Ararat Agency', current: true },
    ]);
    noPlans(OTHER.id);
    viewport(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('what it shows', () => {
    it('surfaces a plan left waiting as soon as the conversation opens — as after a closed browser', async () => {
      await openOn([plan()]);
      const shown = await card();
      // Where it runs, and until when it waits.
      expect(within(shown).getByText('In Ararat Agency')).toBeInTheDocument();
      expect(shown).toHaveTextContent(/Waits for your answer until/);
      expect(shown).toHaveTextContent(en.plan.consequence);
      // It sits in a region named for what it wants.
      expect(screen.getByRole('region', { name: en.plan.region })).toContainElement(shown);
    });

    it('shows each step’s command and every argument exactly — never a paraphrase', async () => {
      await openOn([
        plan({
          steps: [step(1), step(2), step(3, { tool: 'listTeams', arguments: {} })],
        }),
      ]);
      const shown = await card();
      const items = within(shown).getAllByRole('listitem');
      expect(
        items.map((i) => within(i).getByText(/^(createTeam|inviteMember|listTeams)$/).textContent),
      ).toEqual(['createTeam', 'inviteMember', 'listTeams']);
      const pairs = (i: HTMLElement) =>
        within(i)
          .queryAllByRole('term')
          .map((term) => [term.textContent, term.nextElementSibling?.textContent]);
      expect(pairs(items[0]!)).toEqual([['name', '"Field"']]);
      expect(pairs(items[1]!)).toEqual([
        ['email', '"m2@example.test"'],
        ['teams', '["Field"]'],
      ]);
      expect(within(items[2]!).getByText(en.plan.no_arguments)).toBeInTheDocument();
      // The hash it is confirmed by is never shown.
      expect(shown).not.toHaveTextContent(HASH);
    });

    it('offers Decline and Confirm side by side, the same size, neither focused for the reader', async () => {
      await openOn([plan()]);
      await card();
      const [decline, confirm] = [declineButton(), confirmButton()];
      expect(decline.parentElement).toBe(confirm.parentElement);
      expect(decline.parentElement).toHaveClass('grid-cols-2');
      expect(document.activeElement).not.toBe(confirm);
      expect(document.activeElement).not.toBe(decline);
      // Decline comes first in reading and tab order.
      expect(
        decline.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('never confirms on its own', async () => {
      await openOn([plan()]);
      await card();
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(calls(CONFIRM)).toEqual([]);
      expect(calls(DECLINE)).toEqual([]);
    });

    it('lists plans in the order they were proposed, as the conversation reads', async () => {
      const earlier = plan({
        id: '00000000-0000-4000-8000-0000000000c0',
        createdAt: '2026-10-07T10:00:00.000Z',
        steps: [step(1, { tool: 'renameTeam', arguments: { name: 'Field ops' } })],
      });
      // The API lists newest first.
      await openOn([plan({ createdAt: '2026-10-07T10:05:00.000Z' }), earlier]);
      await screen.findAllByRole('group', { name: CARD });
      const tools = screen
        .getAllByRole('group', { name: CARD })
        .map(
          (g) => within(g).getAllByRole('listitem')[0]!.querySelector('p.font-mono')!.textContent,
        );
      expect(tools).toEqual(['renameTeam', 'createTeam']);
    });

    it('is in the full-screen sheet on a phone, never a sheet of its own', async () => {
      await openOn([plan()]);
      const shown = await card();
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs).toHaveLength(1);
      expect(dialogs[0]).toContainElement(shown);
    });

    it('shows three steps on a phone and the rest on request', async () => {
      await openOn([plan({ steps: [1, 2, 3, 4, 5].map((n) => step(n)) })]);
      const shown = await card();
      const items = within(shown).getAllByRole('listitem');
      expect(items.map((i) => i.classList.contains('max-md:hidden'))).toEqual([
        false,
        false,
        false,
        true,
        true,
      ]);
      await userEvent.click(screen.getByRole('button', { name: 'Show all 5 steps' }));
      expect(
        within(shown)
          .getAllByRole('listitem')
          .some((i) => i.classList.contains('max-md:hidden')),
      ).toBe(false);
      expect(screen.queryByRole('button', { name: 'Show all 5 steps' })).toBeNull();
    });

    it('says nothing of the workspace while it cannot be read', async () => {
      api.on('GET /workspaces', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openOn([plan()]);
      expect(await card()).not.toHaveTextContent(/^In /);
      expect(screen.queryByText(/^In /)).toBeNull();
    });
  });

  describe('confirming', () => {
    it('sends exactly the hash it showed, once, and shows it running until its outcome is in the conversation', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await openOn([plan()]);
      await card();

      const release = api.hold(
        CONFIRM,
        200,
        plan({ status: 'CONFIRMED', confirmation: 'CONFIRMED' }),
      );
      await user.click(confirmButton());
      // From the first tap until the API answers, neither can be pressed.
      expect(confirmButton()).toBeDisabled();
      expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
      expect(declineButton()).toBeDisabled();
      await user.click(confirmButton());
      release();

      expect(await screen.findByText(en.plan.running)).toBeInTheDocument();
      // Confirmed, it no longer asks: it says what was confirmed.
      expect(screen.getByRole('group', { name: en.plan.title_running })).toBeInTheDocument();
      expect(calls(CONFIRM)).toHaveLength(1);
      expect(calls(CONFIRM)[0]!.body).toEqual({ planHash: HASH });
      expect(screen.queryByRole('button', { name: en.plan.confirm })).toBeNull();
      expect(within(await card()).getAllByText(en.plan.status.pending)).toHaveLength(2);

      // Read again while it runs: a step at a time.
      api.on(
        ONE,
        200,
        plan({
          status: 'EXECUTING',
          confirmation: 'CONFIRMED',
          steps: [step(1, { status: 'DONE' }), step(2, { status: 'RUNNING' })],
        }),
      );
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      const running = await card();
      expect(await within(running).findByText(en.plan.status.done)).toBeInTheDocument();
      expect(within(running).getByText(en.plan.status.running)).toBeInTheDocument();

      // It ends: the plan leaves, and the conversation says how it went.
      api.on(ONE, 200, plan({ status: 'COMPLETED', confirmation: 'CONFIRMED' }));
      api.on(OPEN, 200, []);
      api.on(MESSAGES, 200, newestFirst([QUESTION, outcome('completed')]));
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      expect(await screen.findByText(catalogs.en.assistant.outcome.completed)).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: CARD })).toBeNull();
    });

    it('shows a step that failed while running as failed, with its code', async () => {
      await openOn([
        plan({
          status: 'EXECUTING',
          confirmation: 'CONFIRMED',
          steps: [
            step(1, { status: 'DONE' }),
            step(2, { status: 'FAILED', error: 'forbidden' } as Partial<PlanStep>),
          ],
        }),
      ]);
      const shown = await card();
      expect(within(shown).getByText('Failed (forbidden)')).toBeInTheDocument();
      expect(within(shown).getByText(en.plan.running)).toBeInTheDocument();
    });

    it('keeps watching when a read fails, and lets a plan go that has gone', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      await openOn([plan({ status: 'CONFIRMED', confirmation: 'CONFIRMED' })]);
      await card();

      api.down(ONE);
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      expect(await card()).toBeInTheDocument();
      expect(calls(ONE)).toHaveLength(1);

      // Deleted with its conversation in another tab.
      api.on(ONE, 404, apiError('NOT_FOUND', 'error.common.not_found'));
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      await waitFor(() => expect(screen.queryByRole('group', { name: CARD })).toBeNull());
      expect(calls(ONE)).toHaveLength(2);
    });

    it('reads nothing while the tab is hidden, and reads at once when it shows again (T-235)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      const visibility = vi.spyOn(document, 'visibilityState', 'get');
      const show = (state: DocumentVisibilityState) => {
        visibility.mockReturnValue(state);
        act(() => void document.dispatchEvent(new Event('visibilitychange')));
      };
      await openOn([plan({ status: 'CONFIRMED', confirmation: 'CONFIRMED' })]);
      await card();
      api.on(
        ONE,
        200,
        plan({
          status: 'EXECUTING',
          confirmation: 'CONFIRMED',
          steps: [step(1, { status: 'DONE' }), step(2, { status: 'RUNNING' })],
        }),
      );

      show('hidden');
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 10));
      expect(calls(ONE)).toHaveLength(0);

      // Back in view: read now, not a tick later — then every tick again.
      show('visible');
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(calls(ONE)).toHaveLength(1);
      expect(await within(await card()).findByText(en.plan.status.done)).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      expect(calls(ONE)).toHaveLength(2);

      // Hidden while a read is on its way: it lands, and nothing follows it.
      const release = api.hold(ONE, 200, plan({ status: 'EXECUTING', confirmation: 'CONFIRMED' }));
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      show('hidden');
      release();
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 10));
      expect(calls(ONE)).toHaveLength(3);
      visibility.mockRestore();
    });

    it('starts watching a plan confirmed while the tab was out of view only once it is back', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      await openOn([plan({ status: 'CONFIRMED', confirmation: 'CONFIRMED' })]);
      await card();
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
      expect(calls(ONE)).toHaveLength(0);

      api.on(ONE, 200, plan({ status: 'EXECUTING', confirmation: 'CONFIRMED' }));
      visibility.mockReturnValue('visible');
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(calls(ONE)).toHaveLength(1);
      visibility.mockRestore();
    });
  });

  describe('when the API says no', () => {
    it('tells the person why when the plan changed under them — in the conversation, from where it ended', async () => {
      await openOn([plan()]);
      await card();
      api.on(
        CONFIRM,
        409,
        apiError('STATE_CONFLICT', 'error.validation.ai_plan.changed', {
          details: [
            { field: 'plan', code: 'CHANGED', messageKey: 'error.validation.ai_plan.changed' },
          ],
        }),
      );
      api.on(
        ONE,
        200,
        plan({ status: 'CANCELLED', confirmation: 'INVALIDATED', reason: 'hash_mismatch' }),
      );
      api.on(OPEN, 200, []);
      api.on(MESSAGES, 200, newestFirst([QUESTION, outcome('not_run', 'hash_mismatch')]));
      await userEvent.click(confirmButton());

      expect(await screen.findByText(en.outcome.reason.hash_mismatch)).toBeInTheDocument();
      expect(screen.getByText(en.outcome.not_run)).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: CARD })).toBeNull();
    });

    it('cannot be confirmed once past its time: refused, it says so and offers nothing to press', async () => {
      await openOn([plan()]);
      await card();
      api.on(CONFIRM, 409, apiError('STATE_CONFLICT', 'error.validation.ai_plan.expired'));
      api.on(ONE, 200, plan({ confirmation: 'EXPIRED' }));
      await userEvent.click(confirmButton());
      expect(await screen.findByText(en.plan.expired)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.plan.confirm })).toBeNull();
      expect(screen.queryByRole('button', { name: en.plan.decline })).toBeNull();
      // It no longer asks.
      expect(screen.getByRole('group', { name: en.plan.title_expired })).toBeInTheDocument();
    });

    it('stops offering Confirm when its time passes while it is shown', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      await openOn([plan({ expiresAt: new Date(Date.now() + 60_000).toISOString() })]);
      await card();
      expect(confirmButton()).toBeEnabled();
      await act(() => vi.advanceTimersByTimeAsync(61_000));
      expect(await screen.findByText(en.plan.expired)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.plan.confirm })).toBeNull();
    });

    it('shows a plan answered in another tab as it now stands', async () => {
      await openOn([plan()]);
      await card();
      api.on(CONFIRM, 409, apiError('STATE_CONFLICT', 'error.validation.ai_plan.not_pending'));
      api.on(ONE, 200, plan({ status: 'CONFIRMED', confirmation: 'CONFIRMED' }));
      await userEvent.click(confirmButton());
      expect(await screen.findByText(en.plan.running)).toBeInTheDocument();
    });

    it('says what went wrong when it could not be sent, and lets the person try again', async () => {
      await openOn([plan()]);
      await card();
      api.down(CONFIRM);
      api.down(ONE);
      await userEvent.click(confirmButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
      expect(confirmButton()).toBeEnabled();

      api.on(CONFIRM, 200, plan({ status: 'CONFIRMED', confirmation: 'CONFIRMED' }));
      await userEvent.click(confirmButton());
      expect(await screen.findByText(en.plan.running)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('lets a plan go that was deleted before the answer arrived', async () => {
      await openOn([plan()]);
      await card();
      api.on(CONFIRM, 404, apiError('NOT_FOUND', 'error.common.not_found'));
      api.on(ONE, 404, apiError('NOT_FOUND', 'error.common.not_found'));
      await userEvent.click(confirmButton());
      await waitFor(() => expect(screen.queryByRole('group', { name: CARD })).toBeNull());
    });
  });

  describe('a yes in words (T-220)', () => {
    const pointer = (planId: string) =>
      aiMessage({
        id: 'r2',
        sequence: 3,
        role: 'ASSISTANT',
        content: '',
        metadata: { source: 'routing', status: 'confirm_pointer', planId },
      });

    it('is pointed at the plan — showing it focuses the plan, never Confirm', async () => {
      const yes = aiMessage({ id: 'y1', sequence: 2, content: 'yes' });
      await openOn([plan()], [QUESTION, yes, pointer(PLAN_ID)]);
      const shown = await card();
      expect(screen.getByText(en.routing.confirm_pointer)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: en.routing.show_plan }));
      expect(document.activeElement).toBe(shown);
      expect(calls(CONFIRM)).toEqual([]);
    });

    it('offers nothing to show once that plan no longer waits', async () => {
      await openOn([], [QUESTION, pointer(PLAN_ID)]);
      expect(await screen.findByText(en.routing.confirm_pointer)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.routing.show_plan })).toBeNull();
    });
  });

  describe('declining', () => {
    it('runs nothing, and the conversation says it was declined', async () => {
      await openOn([plan()]);
      await card();
      api.on(
        DECLINE,
        200,
        plan({ status: 'CANCELLED', confirmation: 'DECLINED', reason: 'declined' }),
      );
      api.on(OPEN, 200, []);
      api.on(MESSAGES, 200, newestFirst([QUESTION, outcome('declined')]));
      await userEvent.click(declineButton());
      expect(await screen.findByText(en.outcome.declined)).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: CARD })).toBeNull();
      expect(calls(CONFIRM)).toEqual([]);
    });
  });

  describe('reading the plans', () => {
    it('says when they could not be read, and reads them again on request', async () => {
      api.on(LATEST, 200, { ...emptyPage, items: [SESSION] });
      api.on(MESSAGES, 200, newestFirst([QUESTION]));
      api.on(OPEN, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openAssistant();
      expect(await screen.findByText(en.plan.failed)).toBeInTheDocument();

      api.on(OPEN, 200, [plan()]);
      await userEvent.click(screen.getByRole('button', { name: en.plan.reload }));
      expect(await card()).toBeInTheDocument();
      expect(screen.queryByText(en.plan.failed)).toBeNull();
    });

    it('reads them again when the conversation grows, and lets one go that ended elsewhere', async () => {
      await openOn([plan()]);
      await card();
      // The person asks something; the plan meanwhile was declined in another tab.
      api.on(OPEN, 200, []);
      api.streamed(`POST /ai/sessions/${SESSION.id}/turns`, [
        {
          type: 'message',
          message: aiMessage({ id: 'q2', sequence: 2, content: 'Anything else?' }),
        },
        { type: 'done' },
      ]);
      api.on(OPEN, 200, []);
      api.on(MESSAGES, 200, newestFirst([QUESTION, outcome('declined')]));
      await userEvent.type(
        screen.getByRole('textbox', { name: en.composer.label }),
        'Anything else?',
      );
      await userEvent.click(screen.getByRole('button', { name: en.composer.send }));
      await waitFor(() => expect(screen.queryByRole('group', { name: CARD })).toBeNull());
      expect(await screen.findByText(en.outcome.declined)).toBeInTheDocument();
    });

    it('keeps what was just said in view above a plan that waits, rather than the plan again', async () => {
      await openOn([plan()]);
      await card();
      const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
      api.streamed(`POST /ai/sessions/${SESSION.id}/turns`, [
        { type: 'message', message: aiMessage({ id: 'q2', sequence: 2, content: 'Is Ana free?' }) },
        {
          type: 'message',
          message: aiMessage({ id: 'a2', sequence: 3, role: 'ASSISTANT', content: 'Yes, she is.' }),
        },
        { type: 'done' },
      ]);
      await userEvent.type(
        screen.getByRole('textbox', { name: en.composer.label }),
        'Is Ana free?',
      );
      await userEvent.click(screen.getByRole('button', { name: en.composer.send }));
      await screen.findByText('Yes, she is.');
      const target = scrolled.mock.contexts.at(-1) as HTMLElement;
      // The conversation's end — the reply — not the plan below it.
      expect(target).toContainElement(screen.getByText('Yes, she is.'));
      expect(target).not.toContainElement(await card());
      expect(scrolled.mock.calls.at(-1)).toEqual([{ block: 'end' }]);
    });

    it('forgets one conversation’s plans when another opens', async () => {
      const release = api.hold(OPEN, 200, [plan()]);
      api.on(LATEST, 200, { ...emptyPage, items: [SESSION] });
      api.on(MESSAGES, 200, newestFirst([QUESTION]));
      api.on('GET /ai/sessions?archived=false&limit=20', 200, {
        ...emptyPage,
        items: [SESSION, OTHER],
      });
      api.on(`GET /ai/sessions/${OTHER.id}/messages?order=newest&limit=30`, 200, newestFirst([]));
      await openAssistant();
      await screen.findByRole('heading', { name: SESSION.title! });
      await userEvent.click(screen.getByRole('button', { name: en.sessions.open }));
      await userEvent.click(await screen.findByRole('button', { name: /Quotes/ }));
      await screen.findByRole('heading', { name: OTHER.title! });
      release();
      await act(() => new Promise((r) => setTimeout(r, 20)));
      expect(screen.queryByRole('group', { name: CARD })).toBeNull();
    });
  });
});
