import { catalogs } from '@investigator/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newestFirst, openAssistant, viewport } from '@/test/assistant';
import { api } from '@/test/api';
import {
  aiDiscoveryReply,
  aiMessage,
  aiReply,
  aiSession,
  discoveryAnswer,
  emptyPage,
  investigatorMatch,
} from '@/test/fixtures';

const en = catalogs.en.assistant;
const d = en.discovery;
const S = aiSession({ title: 'Due diligence in Yerevan' });
const LATEST = 'GET /ai/sessions?limit=1';
const PAGE = `GET /ai/sessions/${S.id}/messages?order=newest&limit=30`;
const TURN = `POST /ai/sessions/${S.id}/turns`;
const QUESTION = aiMessage({ content: 'Someone for due diligence in Yerevan' });

/** The assistant, opened on a conversation that ends with these messages. */
const showing = async (...messages: ReturnType<typeof aiMessage>[]) => {
  api.on(LATEST, 200, { ...emptyPage, items: [S] });
  api.on(PAGE, 200, newestFirst(messages));
  await openAssistant();
  return screen.findByRole('log');
};
const turnBody = () => api.calls.find((c) => c.path === `/ai/sessions/${S.id}/turns`)?.body;

describe('structured results in the assistant (T-059)', () => {
  beforeEach(() => {
    api.install();
    api.on('GET /workspaces', 200, []);
    viewport(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('investigators found', () => {
    it('shows each as a card built from the data — who they are, and why, from what matched', async () => {
      await showing(QUESTION, aiDiscoveryReply(discoveryAnswer()));
      const [card, unnamed] = screen.getAllByRole('article') as [HTMLElement, HTMLElement];
      expect(within(card).getByRole('heading', { name: 'Ani Hakobyan' })).toBeInTheDocument();
      expect(card).toHaveTextContent('Corporate due diligence across the South Caucasus');
      expect(card).toHaveTextContent(d.verified);
      expect(card).toHaveTextContent('9 years of experience');

      // The reasons: each a code from matchedOn / notMatched, phrased here.
      const why = within(within(card).getByRole('region', { name: d.why })).getAllByRole(
        'listitem',
      );
      expect(why.map((li) => li.textContent)).toEqual([
        'Offers Due diligence',
        'Speaks Armenian',
        'Works in Yerevan, Armenia',
        '4 km away',
        expect.stringMatching(/^Available Monday, 9:00\sAM–5:00\sPM$/),
        // A gap is said, not hidden.
        'Does not offer Surveillance',
      ]);

      // Languages, specialties and hours from the profile's data, not from prose.
      const facts = within(card)
        .getAllByRole('term')
        .map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
      expect(facts).toEqual([
        [d.languages, 'Armenian and English'],
        [d.specialties, 'Fraud investigation and Due diligence'],
        [d.hours, expect.stringMatching(/^Monday 9:00\sAM–5:00\sPM$/)],
      ]);

      // A profile with no name, headline or experience says only what it has.
      expect(within(unnamed).getByRole('heading', { name: d.unnamed })).toBeInTheDocument();
      expect(within(unnamed).queryByRole('region', { name: d.why })).toBeNull();
      expect(unnamed).not.toHaveTextContent('years of experience');
    });

    it('says what it searched for, and what it assumed, so it can be corrected', async () => {
      await showing(
        QUESTION,
        aiDiscoveryReply(
          discoveryAnswer({
            searchedFor: {
              place: null,
              near: false,
              radiusKm: null,
              specialties: [
                { id: 'n-dd', label: 'Due diligence' },
                { id: 'n-x', label: null },
              ],
              languages: ['ru'],
              availability: { dayOfWeek: 5, startMinute: 600, endMinute: 1440 },
            },
            assumptions: ['location.anywhere'],
            orderedBy: 'experience',
            hasMore: true,
          }),
        ),
      );
      expect(
        screen.getByText(/^Searched for: Due diligence, Russian, and Saturday/),
      ).toBeInTheDocument();
      expect(screen.getByText(d.anywhere)).toBeInTheDocument();
      expect(screen.getByText(d.ordered.experience)).toBeInTheDocument();
      // Never ten thousand rows: a few, and the way to narrow.
      expect(screen.getByText(d.more)).toBeInTheDocument();
    });

    it('says when it searched near the reader, and how far', async () => {
      const near = (radiusKm: number | null) =>
        aiDiscoveryReply(
          discoveryAnswer({
            searchedFor: {
              place: null,
              near: true,
              radiusKm,
              specialties: [],
              languages: [],
              availability: null,
            },
            orderedBy: 'distance',
            results: [investigatorMatch()],
          }),
          { id: `d-${radiusKm}`, sequence: radiusKm === null ? 2 : 4 },
        );
      await showing(QUESTION, near(25), aiMessage({ id: 'q3', sequence: 3 }), near(null));
      expect(screen.getByText('Searched for: within 25 km')).toBeInTheDocument();
      expect(screen.getByText(`Searched for: ${d.near_you}`)).toBeInTheDocument();
      // One result has no order to speak of.
      expect(screen.queryByText(d.ordered.distance)).toBeNull();
    });

    it('says plainly when nobody matches — a state, not a buried apology', async () => {
      await showing(
        QUESTION,
        aiDiscoveryReply(discoveryAnswer({ status: 'no_results', results: [], orderedBy: null })),
      );
      expect(screen.getByText(d.none)).toBeInTheDocument();
      expect(screen.queryByRole('article')).toBeNull();
    });
  });

  describe('the one question discovery asks', () => {
    const asked = (
      clarification: NonNullable<ReturnType<typeof discoveryAnswer>['clarification']>,
    ) =>
      aiDiscoveryReply(
        discoveryAnswer({
          status: 'clarification',
          clarification,
          searchedFor: null,
          results: [],
          orderedBy: null,
        }),
      );

    it('which specialty: one tap answers it — and once answered, the choice is gone', async () => {
      api.streamed(TURN, [{ type: 'done' }]);
      await showing(
        QUESTION,
        asked({
          code: 'specialty',
          options: [
            { id: 'n-corp', label: 'Corporate' },
            { id: 'n-asset', label: 'Asset tracing' },
            { id: 'n-none', label: null },
          ],
        }),
      );
      expect(screen.getByText(d.clarify.specialty)).toBeInTheDocument();
      // An option with no name in this language cannot be chosen by name.
      expect(screen.getAllByRole('button', { name: /Corporate|Asset tracing/ })).toHaveLength(2);
      await userEvent.click(screen.getByRole('button', { name: 'Asset tracing' }));
      await waitFor(() =>
        expect(turnBody()).toEqual({
          content: 'Asset tracing',
          clarifies: true,
          taxonomyNodeIds: ['n-asset'],
        }),
      );
    });

    it('offers nothing to press once the conversation has moved on', async () => {
      await showing(
        QUESTION,
        asked({ code: 'specialty', options: [{ id: 'n-corp', label: 'Corporate' }] }),
        aiMessage({ id: 'q3', sequence: 3, content: 'Corporate' }),
      );
      expect(screen.getByText(d.clarify.specialty)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Corporate' })).toBeNull();
    });

    it('where: the device’s location, rounded to about a kilometre, answers it', async () => {
      api.streamed(TURN, [{ type: 'done' }]);
      vi.stubGlobal('navigator', {
        ...navigator,
        geolocation: {
          getCurrentPosition: (
            ok: (p: { coords: { latitude: number; longitude: number } }) => void,
          ) => ok({ coords: { latitude: 40.187241, longitude: 44.515231 } }),
        },
      });
      await showing(QUESTION, asked({ code: 'location' }));
      await userEvent.click(screen.getByRole('button', { name: d.clarify.use_location }));
      await waitFor(() =>
        expect(turnBody()).toEqual({
          content: d.clarify.my_location,
          clarifies: true,
          near: { lon: 44.52, lat: 40.19 },
        }),
      );
    });

    it('where: says when the location is refused, and takes a place in words instead', async () => {
      api.streamed(TURN, [{ type: 'done' }]);
      let answer!: (ok: boolean) => void;
      vi.stubGlobal('navigator', {
        ...navigator,
        geolocation: {
          getCurrentPosition: (_ok: unknown, fail: () => void) => {
            answer = () => fail();
          },
        },
      });
      await showing(QUESTION, asked({ code: 'location' }));
      await userEvent.click(screen.getByRole('button', { name: d.clarify.use_location }));
      expect(screen.getByRole('button', { name: d.clarify.locating })).toBeDisabled();
      answer(false);
      expect(await screen.findByText(d.clarify.location_denied)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: d.clarify.use_location })).toBeNull();

      const place = screen.getByRole('textbox', { name: d.clarify.place });
      await userEvent.type(place, 'Gy');
      expect(screen.getByRole('button', { name: d.clarify.place_send })).toBeDisabled();
      await userEvent.type(place, 'umri{Enter}');
      await waitFor(() => expect(turnBody()).toEqual({ content: 'Gyumri', clarifies: true }));
    });

    it('where: offers no location button on a device that has none', async () => {
      const { geolocation: _gone, ...rest } = navigator as Navigator & { geolocation: unknown };
      vi.stubGlobal('navigator', rest);
      await showing(QUESTION, asked({ code: 'location' }));
      expect(screen.queryByRole('button', { name: d.clarify.use_location })).toBeNull();
      expect(screen.getByRole('textbox', { name: d.clarify.place })).toBeInTheDocument();
    });

    it('what for: the person’s own words answer it', async () => {
      api.streamed(TURN, [{ type: 'done' }]);
      await showing(QUESTION, asked({ code: 'purpose' }));
      expect(screen.getByText(d.clarify.purpose)).toBeInTheDocument();
      await userEvent.type(
        screen.getByRole('textbox', { name: d.clarify.purpose_label }),
        'To serve court papers',
      );
      await userEvent.click(screen.getByRole('button', { name: d.clarify.purpose_send }));
      await waitFor(() =>
        expect(turnBody()).toEqual({ content: 'To serve court papers', clarifies: true }),
      );
    });
  });

  describe('a refusal', () => {
    it('says what happened and points to the policy — closing the sheet on the way on a phone', async () => {
      await showing(
        aiMessage({ content: 'Find someone to read my wife’s messages' }),
        aiDiscoveryReply(
          discoveryAnswer({
            status: 'refused',
            searchedFor: null,
            results: [],
            orderedBy: null,
            refusal: { code: 'prohibited_request', document: 'kb-policy-prohibited-requests' },
          }),
        ),
      );
      const note = screen.getByRole('note');
      expect(note).toHaveTextContent(d.refused.title);
      expect(note).toHaveTextContent(d.refused.body);
      const policy = within(note).getByRole('link', { name: d.refused.policy });
      expect(policy).toHaveAttribute('href', '/help/kb-policy-prohibited-requests');
      policy.addEventListener('click', (e) => e.preventDefault());
      await userEvent.click(policy);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });

  describe('sources', () => {
    it('link to the article, at the section used — and the docked panel stays open beside it', async () => {
      viewport(true);
      await showing(aiMessage(), aiReply());
      const source = screen.getByRole('link', {
        name: 'Quotes and expiry · How long does a quote stay valid?',
      });
      expect(source).toHaveAttribute(
        'href',
        '/help/kb-customer-quotes#how-long-does-a-quote-stay-valid',
      );
      source.addEventListener('click', (e) => e.preventDefault());
      await userEvent.click(source);
      expect(screen.getByRole('complementary')).toBeInTheDocument();
    });
  });

  it('names the new steps as they happen: working out what is asked, then finding investigators', async () => {
    const stream = api.stream(TURN);
    await showing(QUESTION, aiReply());
    await userEvent.type(
      screen.getByRole('textbox', { name: en.composer.label }),
      'Someone in Gyumri',
    );
    await userEvent.click(screen.getByRole('button', { name: en.composer.send }));
    stream.send({ type: 'step', step: { step: 'understanding' } });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(en.step.understanding),
    );
    stream.send({ type: 'step', step: { step: 'finding' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.step.finding));
  });
});
