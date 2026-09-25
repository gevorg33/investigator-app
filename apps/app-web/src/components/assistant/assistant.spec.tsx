import { catalogs } from '@investigator/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { aiMessage, aiReply, aiSession, emptyPage } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { AssistantPanel } from './assistant-panel';
import { AssistantProvider, useAssistant, type AssistantAudience } from './assistant-provider';

const en = catalogs.en.assistant;
const SESSION = aiSession();
const LATEST = 'GET /ai/sessions?limit=1';
const MESSAGES = `GET /ai/sessions/${SESSION.id}/messages?limit=100`;
const TURN = `POST /ai/sessions/${SESSION.id}/turns`;
const RETRY = `POST /ai/sessions/${SESSION.id}/turns/retry`;
const QUESTION = 'How long does a quote stay valid?';

/** What opens the assistant in the shell — here, one button. */
function Opener() {
  const { toggle } = useAssistant();
  return (
    <button type="button" onClick={toggle}>
      Open assistant
    </button>
  );
}

/** A window as wide as `docked` says, which can be resized while the spec runs. */
function viewport(docked: boolean) {
  const listeners = new Set<() => void>();
  const size = { docked };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: size.docked,
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return (next: boolean) => {
    size.docked = next;
    act(() => listeners.forEach((l) => l()));
  };
}

const openWith = async ({
  latest = null,
  messages = [],
  audience = 'CUSTOMER',
  held = false,
}: {
  latest?: ReturnType<typeof aiSession> | null;
  messages?: ReturnType<typeof aiMessage>[];
  audience?: AssistantAudience;
  /** The spec has set the reply to the latest-conversation read itself. */
  held?: boolean;
} = {}) => {
  if (!held) api.on(LATEST, 200, { ...emptyPage, items: latest === null ? [] : [latest] });
  if (latest !== null) api.on(MESSAGES, 200, { ...emptyPage, items: messages });
  renderIntl(
    <AssistantProvider audience={audience} activeRole={null}>
      <Opener />
      <AssistantPanel />
    </AssistantProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
};

const composer = () => screen.getByRole('textbox', { name: en.composer.label });
const ask = async (text = QUESTION) => {
  await userEvent.type(composer(), text);
  await userEvent.click(screen.getByRole('button', { name: en.composer.send }));
};
const log = () => screen.getByRole('log');
/** The conversation's entries — not the lists inside them, such as an answer's sources. */
const entries = () => [...log().children] as HTMLElement[];

describe('the assistant’s context', () => {
  it('is only to be had inside its provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderIntl(<Opener />)).toThrow('useAssistant is used outside AssistantProvider');
    vi.restoreAllMocks();
  });
});

describe('the assistant (T-056)', () => {
  beforeEach(() => {
    api.install();
    api.on('GET /workspaces', 200, [
      { id: 'w1', kind: 'PERSONAL', name: null, current: true },
      { id: 'w2', kind: 'AGENCY', name: 'Ararat Agency', current: false },
    ]);
    viewport(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('where it opens', () => {
    it('is a full-screen sheet on a phone, with no handle to drag it away, opening on the composer', async () => {
      await openWith();
      const sheet = await screen.findByRole('dialog', { name: en.untitled });
      expect(sheet).toHaveClass('h-dvh');
      expect(sheet.querySelector('.rounded-full.w-12')).toBeNull();
      await waitFor(() => expect(composer()).toHaveFocus());
      await userEvent.click(within(sheet).getByRole('button', { name: en.close }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('docks beside the page from lg up — not a dialog — and Escape closes it back to its opener', async () => {
      const resize = viewport(true);
      await openWith();
      const panel = screen.getByRole('complementary', { name: en.label });
      expect(panel).toHaveAttribute('id', 'assistant-panel');
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(composer()).toHaveFocus());

      // Typing is not closing.
      await userEvent.type(composer(), 'Esc');
      expect(panel).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(screen.getByRole('button', { name: 'Open assistant' })).toHaveFocus();

      // Narrowed below lg while open, the same conversation becomes the sheet.
      await userEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
      resize(false);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      resize(true);
      await userEvent.click(screen.getByRole('button', { name: en.close }));
      expect(screen.getByRole('button', { name: 'Open assistant' })).toHaveFocus();
    });

    it('shows the workspace the conversation belongs to', async () => {
      await openWith();
      expect(await screen.findByText(en.workspace.personal)).toBeInTheDocument();
    });

    it('names an agency workspace, and shows none when the list cannot be read', async () => {
      api.on('GET /workspaces', 200, [
        { id: 'w2', kind: 'AGENCY', name: 'Ararat Agency', current: true },
      ]);
      await openWith();
      expect(await screen.findByText('Ararat Agency')).toBeInTheDocument();
    });

    it('works without the workspace’s name when it cannot be read', async () => {
      api.on('GET /workspaces', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openWith();
      await screen.findByRole('heading', { name: en.empty.title });
      expect(screen.queryByText(en.workspace.personal)).toBeNull();
    });
  });

  describe('what it opens on', () => {
    it('follows the conversation to its end as it grows', async () => {
      const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
      await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
      await screen.findByRole('log');
      expect(log().closest('.overflow-y-auto')!.scrollTop).toBe(900);
      tall.mockRestore();
    });

    it('continues the latest conversation while it is still active, sources and all', async () => {
      await openWith({
        latest: aiSession({ title: 'Quote validity' }),
        messages: [aiMessage(), aiReply()],
      });
      expect(await screen.findByRole('dialog', { name: 'Quote validity' })).toBeInTheDocument();
      const items = entries();
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent(`${en.speaker.you}: ${QUESTION}`);
      expect(items[1]).toHaveTextContent('Until the validity period its investigator set.');
      expect(items[1]).toHaveTextContent(en.reply.sources);
      expect(items[1]).toHaveTextContent('Quotes and expiry · How long does a quote stay valid?');
      expect(screen.queryByText(en.reply.fallback)).toBeNull();
    });

    it('starts a new one when the latest has gone quiet, reading none of its messages', async () => {
      await openWith({ latest: aiSession({ status: 'IDLE' }) });
      expect(await screen.findByRole('heading', { name: en.empty.title })).toBeInTheDocument();
      expect(api.calls.some((c) => c.path.includes('/messages'))).toBe(false);
      // Nothing to leave yet, so no "new conversation".
      expect(screen.queryByRole('button', { name: en.new })).toBeNull();
    });

    it('reads the conversation only once, however often it is opened', async () => {
      await openWith();
      await screen.findByRole('heading', { name: en.empty.title });
      await userEvent.click(screen.getByRole('button', { name: en.close }));
      await userEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
      await screen.findByRole('heading', { name: en.empty.title });
      expect(api.calls.filter((c) => c.path === '/ai/sessions?limit=1')).toHaveLength(1);
    });

    it('holds the composer while it reads, and says so when it cannot', async () => {
      const release = api.hold(LATEST, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await openWith({ held: true });
      await userEvent.type(composer(), QUESTION);
      expect(screen.getByRole('button', { name: en.composer.send })).toBeDisabled();
      release();
      expect(await screen.findByText(en.load.failed)).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);

      api.on(LATEST, 200, emptyPage);
      await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
      expect(await screen.findByRole('heading', { name: en.empty.title })).toBeInTheDocument();
    });

    it('offers to answer a question the history left unanswered', async () => {
      await openWith({ latest: SESSION, messages: [aiMessage()] });
      expect(await screen.findByText(en.turn.unanswered)).toBeInTheDocument();
      api.streamed(RETRY, [
        { type: 'step', step: { step: 'searching' } },
        { type: 'message', message: aiReply() },
        { type: 'done' },
      ]);
      await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
      expect(await within(log()).findByText(/Until the validity period/)).toBeInTheDocument();
      expect(screen.queryByText(en.turn.unanswered)).toBeNull();
    });

    it('reads the conversation back when a retry finds it answered elsewhere', async () => {
      await openWith({ latest: SESSION, messages: [aiMessage()] });
      await screen.findByText(en.turn.unanswered);
      api.on(RETRY, 409, apiError('STATE_CONFLICT', 'error.common.state_conflict'));
      api.on(MESSAGES, 200, { ...emptyPage, items: [aiMessage(), aiReply()] });
      await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
      expect(await within(log()).findByText(/Until the validity period/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.turn.retry })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says why, when a retry conflicts and the conversation cannot be read back', async () => {
      await openWith({ latest: SESSION, messages: [aiMessage()] });
      await screen.findByText(en.turn.unanswered);
      api.on(RETRY, 409, apiError('STATE_CONFLICT', 'error.common.state_conflict'));
      api.on(MESSAGES, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        catalogs.en.error.common.state_conflict,
      );
    });

    it('renders tool events as structured blocks and a system note as a note — never as prose', async () => {
      await openWith({
        latest: SESSION,
        messages: [
          aiMessage(),
          aiMessage({
            id: 'm2',
            sequence: 2,
            role: 'ASSISTANT',
            kind: 'TOOL_CALL',
            content: null,
            event: { tool: 'searchInvestigators', arguments: { city: 'Yerevan', radiusKm: 25 } },
          }),
          aiMessage({
            id: 'm3',
            sequence: 3,
            role: 'TOOL',
            kind: 'TOOL_RESULT',
            content: null,
            event: { tool: 'searchInvestigators', resultId: 'res_1' },
          }),
          aiMessage({
            id: 'm4',
            sequence: 4,
            role: 'ASSISTANT',
            kind: 'TOOL_CALL',
            content: null,
            event: { tool: 'listTaxonomy', arguments: null },
          }),
          aiMessage({ id: 'm5', sequence: 5, role: 'SYSTEM', content: 'Conversation resumed.' }),
          aiMessage({ id: 'm6', sequence: 6, role: 'ASSISTANT', content: 'Plain words.' }),
        ],
      });
      await screen.findByRole('log');
      const items = entries();
      expect(items[1]).toHaveTextContent('Used searchInvestigators');
      expect(
        within(items[1]!)
          .getAllByRole('term')
          .map((t) => [t.textContent, t.nextElementSibling?.textContent]),
      ).toEqual([
        ['city', '"Yerevan"'],
        ['radiusKm', '25'],
      ]);
      expect(items[2]).toHaveTextContent('Result from searchInvestigators');
      expect(within(items[2]!).queryAllByRole('term')).toEqual([]);
      expect(items[3]).toHaveTextContent('Used listTaxonomy');
      expect(within(items[3]!).queryAllByRole('term')).toEqual([]);
      expect(items[4]).toHaveTextContent('Conversation resumed.');
      expect(items[5]).toHaveTextContent('Plain words.');
      expect(items[5]).not.toHaveTextContent(en.reply.sources);
    });
  });

  describe('the empty state', () => {
    it('teaches a customer what to ask, and asks it with one tap', async () => {
      api.on('POST /ai/sessions', 201, SESSION);
      api.streamed(TURN, [
        { type: 'message', message: aiMessage({ content: en.empty.customer.quote }) },
        { type: 'message', message: aiReply() },
        { type: 'done' },
      ]);
      await openWith();
      expect(await screen.findByText(en.empty.body)).toBeInTheDocument();
      const suggestions = within(screen.getByRole('region', { name: en.empty.suggestions }))
        .getAllByRole('button')
        .map((b) => b.textContent);
      expect(suggestions).toEqual([
        en.empty.customer.mission,
        en.empty.customer.quote,
        en.empty.customer.evidence,
      ]);
      await userEvent.click(screen.getByRole('button', { name: en.empty.customer.quote }));
      expect(await within(log()).findByText(/Until the validity period/)).toBeInTheDocument();
      expect(api.calls.find((c) => c.path.endsWith('/turns'))?.body).toEqual({
        content: en.empty.customer.quote,
      });
    });

    it('offers an account with no role the public questions, and closes on the way to adding one', async () => {
      await openWith({ audience: 'NONE' });
      await screen.findByRole('heading', { name: en.empty.title });
      expect(
        within(screen.getByRole('region', { name: en.empty.suggestions }))
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual([en.empty.public.work, en.empty.public.training, en.empty.public.responsibilities]);
      expect(screen.getByText(en.empty.no_role, { exact: false })).toBeInTheDocument();
      const link = screen.getByRole('link', { name: en.empty.no_role_link });
      link.addEventListener('click', (e) => e.preventDefault());
      await userEvent.click(link);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('says nothing about roles to an account that has one', async () => {
      await openWith();
      await screen.findByRole('heading', { name: en.empty.title });
      expect(screen.queryByText(en.empty.no_role, { exact: false })).toBeNull();
    });

    it('teaches an investigator an investigator’s questions', async () => {
      await openWith({ audience: 'INVESTIGATOR' });
      await screen.findByRole('heading', { name: en.empty.title });
      expect(
        within(screen.getByRole('region', { name: en.empty.suggestions }))
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual([
        en.empty.investigator.start,
        en.empty.investigator.paid,
        en.empty.investigator.missions,
      ]);
    });
  });

  describe('a turn', () => {
    it('shows each stage as it happens — never a spinner — then the checked answer, whole', async () => {
      api.on('POST /ai/sessions', 201, SESSION);
      const stream = api.stream(TURN);
      await openWith();
      await screen.findByRole('heading', { name: en.empty.title });
      await ask();

      // Before the server confirms it: the question, and what is happening to it.
      expect(await screen.findByRole('status')).toHaveTextContent(en.step.sending);
      expect(composer()).toHaveValue('');
      expect(screen.getByRole('button', { name: en.composer.stop })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.composer.send })).toBeNull();

      stream.send({ type: 'message', message: aiMessage() });
      stream.send({ type: 'session', session: aiSession({ title: QUESTION }) });
      expect(await within(log()).findByText(QUESTION)).toBeInTheDocument();
      // Named from the question, as it was stored.
      expect(await screen.findByRole('dialog', { name: QUESTION })).toBeInTheDocument();
      // One copy of the question in the conversation: the stored one replaces the one on its way.
      // (The other is the title it gave the conversation.)
      expect(screen.getAllByText(QUESTION)).toHaveLength(2);
      expect(within(log()).getAllByText(QUESTION)).toHaveLength(1);

      stream.send({ type: 'step', step: { step: 'searching' } });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.step.searching));
      stream.send({ type: 'step', step: { step: 'writing', sources: 2 } });
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Writing an answer from 2 sources'),
      );
      // The indicator moves only for a reader who has not asked for less motion.
      expect(
        screen.getByRole('status').querySelector('.motion-safe\\:animate-pulse'),
      ).not.toBeNull();

      stream.send({
        type: 'message',
        message: aiReply({ metadata: { ...aiReply().metadata, fallback: true } }),
      });
      stream.send({ type: 'done' });
      stream.close();
      expect(await within(log()).findByText(/Until the validity period/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      expect(screen.getByText(en.reply.fallback)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: en.composer.send })).toBeInTheDocument();
      expect(api.calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /ai/sessions');
    });

    it('says plainly when the help articles do not cover it', async () => {
      api.on('POST /ai/sessions', 201, SESSION);
      api.streamed(TURN, [
        { type: 'message', message: aiMessage() },
        {
          type: 'message',
          message: aiReply({
            content: '',
            metadata: {
              source: 'knowledge',
              status: 'no_answer',
              citations: [],
              locale: 'en',
              fallback: false,
            },
          }),
        },
        { type: 'done' },
      ]);
      await openWith();
      await screen.findByRole('heading', { name: en.empty.title });
      await ask();
      expect(await within(log()).findByText(en.reply.no_answer)).toBeInTheDocument();
      expect(screen.queryByText(en.reply.sources)).toBeNull();
    });

    it('asks in the conversation it continues, making no new one', async () => {
      await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
      await screen.findByRole('log');
      api.streamed(TURN, [
        { type: 'message', message: aiMessage({ id: 'm3', sequence: 3, content: 'And then?' }) },
        { type: 'done' },
      ]);
      await ask('And then?');
      expect(await within(log()).findByText('And then?')).toBeInTheDocument();
      expect(api.calls.some((c) => c.method === 'POST' && c.path === '/ai/sessions')).toBe(false);
    });

    describe('keyboard', () => {
      it('sends on Enter, adds a line on Shift+Enter, and will not send too little', async () => {
        await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
        await screen.findByRole('log');
        api.streamed(TURN, [{ type: 'done' }]);
        await userEvent.type(composer(), 'hi');
        expect(screen.getByRole('button', { name: en.composer.send })).toBeDisabled();
        await userEvent.keyboard('{Enter}');
        expect(api.calls.some((c) => c.path.endsWith('/turns'))).toBe(false);

        await userEvent.type(composer(), ' there{Shift>}{Enter}{/Shift}second line');
        expect(composer()).toHaveValue('hi there\nsecond line');
        await userEvent.keyboard('{Enter}');
        await waitFor(() =>
          expect(api.calls.find((c) => c.path.endsWith('/turns'))?.body).toEqual({
            content: 'hi there\nsecond line',
          }),
        );
        expect(composer()).toHaveAttribute('enterkeyhint', 'send');
        expect(composer()).toHaveAccessibleDescription(en.composer.hint);
      });

      it('leaves Enter to an input method while it is composing', async () => {
        await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
        await screen.findByRole('log');
        await userEvent.type(composer(), 'Բարև ձեզ');
        const composing = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          isComposing: true,
        });
        act(() => void composer().dispatchEvent(composing));
        expect(composer()).toHaveValue('Բարև ձեզ');
        expect(api.calls.some((c) => c.path.endsWith('/turns'))).toBe(false);
      });
    });

    describe('when it does not end in an answer', () => {
      it('stops on Stop, keeps the stored question, and answers it on Try again', async () => {
        await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
        await screen.findByRole('log');
        const stream = api.stream(TURN);
        await ask('And after that?');
        stream.send({
          type: 'message',
          message: aiMessage({ id: 'm3', sequence: 3, content: 'And after that?' }),
        });
        stream.send({ type: 'step', step: { step: 'searching' } });
        await waitFor(() =>
          expect(screen.getByRole('status')).toHaveTextContent(en.step.searching),
        );

        await userEvent.click(screen.getByRole('button', { name: en.composer.stop }));
        expect(stream.aborted).toBe(true);
        expect(await screen.findByText(en.turn.stopped)).toBeInTheDocument();
        // It was stored — nothing to read back.
        expect(api.calls.filter((c) => c.path.includes('/messages'))).toHaveLength(1);

        api.streamed(RETRY, [
          { type: 'message', message: aiReply({ id: 'm4', sequence: 4 }) },
          { type: 'done' },
        ]);
        await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
        await waitFor(() => expect(entries()).toHaveLength(4));
        expect(screen.queryByText(en.turn.stopped)).toBeNull();
      });

      it('asks the server, when stopped before it confirmed the question, and sends it again if it never arrived', async () => {
        await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
        await screen.findByRole('log');
        const stream = api.stream(TURN);
        await ask('Did this arrive?');
        await screen.findByRole('status');
        await userEvent.click(screen.getByRole('button', { name: en.composer.stop }));
        expect(stream.aborted).toBe(true);
        // Read back: the server has only the old exchange.
        expect(await screen.findByText(en.turn.unsent)).toBeInTheDocument();
        expect(screen.getByText('Did this arrive?')).toBeInTheDocument();

        api.streamed(TURN, [{ type: 'done' }]);
        await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
        await waitFor(() =>
          expect(api.calls.filter((c) => c.path.endsWith('/turns')).map((c) => c.body)).toEqual([
            { content: 'Did this arrive?' },
            { content: 'Did this arrive?' },
          ]),
        );
      });

      it('keeps a question refused before it was stored, in the assistant’s own words, and sends it again', async () => {
        api.on('POST /ai/sessions', 201, SESSION);
        api.on(TURN, 503, apiError('SERVICE_UNAVAILABLE', 'error.common.service_unavailable'));
        await openWith();
        await screen.findByRole('heading', { name: en.empty.title });
        await ask();
        expect(await screen.findByRole('alert')).toHaveTextContent(en.turn.unavailable);
        expect(screen.getByText(en.turn.unsent)).toBeInTheDocument();
        expect(screen.getByText(QUESTION)).toBeInTheDocument();

        api.streamed(TURN, [
          { type: 'message', message: aiMessage() },
          { type: 'message', message: aiReply() },
          { type: 'done' },
        ]);
        await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
        expect(await within(log()).findByText(/Until the validity period/)).toBeInTheDocument();
        // The session made the first time is used again.
        expect(
          api.calls.filter((c) => c.path === '/ai/sessions' && c.method === 'POST'),
        ).toHaveLength(1);
      });

      it('keeps a question the network lost before a session existed', async () => {
        api.down('POST /ai/sessions');
        await openWith();
        await screen.findByRole('heading', { name: en.empty.title });
        await ask();
        expect(await screen.findByRole('alert')).toHaveTextContent(
          catalogs.en.error.common.internal,
        );
        expect(screen.getByText(en.turn.unsent)).toBeInTheDocument();
      });

      it('says why a stored question failed, with the reference support needs, and answers it on retry', async () => {
        await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
        await screen.findByRole('log');
        api.streamed(TURN, [
          { type: 'message', message: aiMessage({ id: 'm3', sequence: 3, content: 'Why?' }) },
          { type: 'step', step: { step: 'searching' } },
          {
            type: 'error',
            error: {
              code: 'INTERNAL_ERROR',
              messageKey: 'error.common.internal',
              correlationId: 'req-56',
            },
          },
          { type: 'done' },
        ]);
        await ask('Why?');
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(catalogs.en.error.common.internal);
        expect(alert).toHaveTextContent('Reference: req-56');
        expect(screen.queryByText(en.turn.unsent)).toBeNull();

        api.streamed(RETRY, [{ type: 'done' }]);
        await userEvent.click(screen.getByRole('button', { name: en.turn.retry }));
        await waitFor(() =>
          expect(api.calls.some((c) => c.path.endsWith('/turns/retry'))).toBe(true),
        );
      });

      it('treats a stream cut off mid-way as a failure, reading back whether the question arrived', async () => {
        await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
        await screen.findByRole('log');
        api.streamed(TURN, []);
        await ask('Cut off?');
        expect(await screen.findByRole('alert')).toHaveTextContent(
          catalogs.en.error.common.internal,
        );
        await waitFor(() =>
          expect(api.calls.filter((c) => c.path.includes('/messages'))).toHaveLength(2),
        );
        expect(screen.getByText(en.turn.unsent)).toBeInTheDocument();
      });

      it('does not read back a question the stream had already confirmed', async () => {
        await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
        await screen.findByRole('log');
        api.streamed(TURN, [
          { type: 'message', message: aiMessage({ id: 'm3', sequence: 3, content: 'Cut off?' }) },
        ]);
        await ask('Cut off?');
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(api.calls.filter((c) => c.path.includes('/messages'))).toHaveLength(1);
        expect(screen.queryByText(en.turn.unsent)).toBeNull();
      });
    });
  });

  describe('a new conversation', () => {
    it('leaves the current one — stopping what runs — and the next question starts another', async () => {
      await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
      await screen.findByRole('log');
      const stream = api.stream(TURN);
      await ask('Still going?');
      await screen.findByRole('status');

      await userEvent.click(screen.getByRole('button', { name: en.new }));
      expect(stream.aborted).toBe(true);
      expect(await screen.findByRole('heading', { name: en.empty.title })).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: en.untitled })).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();

      const other = aiSession({ id: '00000000-0000-4000-8000-00000000a002' });
      api.on('POST /ai/sessions', 201, other);
      api.streamed(`POST /ai/sessions/${other.id}/turns`, [{ type: 'done' }]);
      await ask('A fresh start');
      await waitFor(() =>
        expect(api.calls.some((c) => c.path === `/ai/sessions/${other.id}/turns`)).toBe(true),
      );
    });

    it('ignores a server that keeps talking about a conversation already left', async () => {
      await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
      await screen.findByRole('log');
      // A stream deaf to Stop: whatever it says after, the page must not believe.
      let say!: (text: string) => void;
      const body = new ReadableStream<Uint8Array>({
        start: (c) => void (say = (text) => c.enqueue(new TextEncoder().encode(text))),
      });
      const real = globalThis.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) =>
          url.endsWith('/turns')
            ? new Response(body, { headers: { 'content-type': 'text/event-stream' } })
            : real(url, init),
        ),
      );
      await ask('Still there?');
      await screen.findByRole('status');
      await userEvent.click(screen.getByRole('button', { name: en.new }));
      await screen.findByRole('heading', { name: en.empty.title });
      act(() =>
        say(
          `event: message\ndata: ${JSON.stringify({ message: aiMessage({ id: 'late', sequence: 9, content: 'Late words' }) })}\n\n`,
        ),
      );
      await act(async () => undefined);
      expect(screen.queryByText('Late words')).toBeNull();
      expect(screen.getByRole('heading', { name: en.empty.title })).toBeInTheDocument();
    });

    it('ignores what the old conversation says after it was left', async () => {
      await openWith({ latest: SESSION, messages: [aiMessage(), aiReply()] });
      await screen.findByRole('log');
      api.stream(TURN);
      await ask('Unconfirmed?');
      await screen.findByRole('status');
      // Stopped before confirmation: a read-back starts, and is held.
      const release = api.hold(MESSAGES, 200, { ...emptyPage, items: [aiMessage(), aiReply()] });
      await userEvent.click(screen.getByRole('button', { name: en.composer.stop }));
      await screen.findByText(en.turn.unsent);
      await userEvent.click(screen.getByRole('button', { name: en.new }));
      release();
      await screen.findByRole('heading', { name: en.empty.title });
      await act(async () => undefined);
      expect(screen.queryByRole('log')).toBeNull();
    });
  });
});
