import { catalogs } from '@investigator/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnMission } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { ownMission } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { MissionIntake } from './mission-intake';
import type { Step } from './steps';
import { EMPTY, SAVE_DELAY_MS } from './use-draft';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.missions;
const ID = 'b7d3f0c2-5a61-4c1e-9f0a-3e2d1c4b5a69';
const DD = '5f51f336-5c7a-442a-909f-8d54d5abf81b';
const CORP = '6033b823-2a6d-4073-bc7b-f59ad3a5c2fd';
const OPTIONS = {
  categories: [
    { id: CORP, label: 'Corporate', depth: 0 },
    { id: DD, label: 'Due diligence', depth: 1 },
    { id: 'deep', label: 'Deep checks', depth: 2 },
  ],
  countries: [
    { code: 'AM', name: 'Armenia' },
    { code: 'GE', name: 'Georgia' },
  ],
  languages: [
    { code: 'en', name: 'English' },
    { code: 'hy', name: 'Armenian' },
    { code: 'ru', name: 'Russian' },
  ],
  currencies: ['AMD', 'JPY', 'USD'],
};

const saved = (over: Partial<OwnMission> = {}) =>
  ownMission({ ...EMPTY, id: ID, version: 1, ...over });

const open = (
  mission: OwnMission | null = null,
  step?: Step,
  options: Partial<typeof OPTIONS> = {},
) => renderIntl(<MissionIntake mission={mission} step={step} {...OPTIONS} {...options} />);

const user = () => userEvent.setup({ delay: null });
/** Lets the pause after typing pass, so the draft saves. */
const pause = () => act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS));
const writes = () => api.calls.filter((c) => c.method !== 'GET');
const heading = () => screen.getByRole('heading', { level: 2 });
/** The question on screen, once moving to it has settled — a move waits for the save before it. */
const arrive = (name: string) => screen.findByRole('heading', { level: 2, name });
const next = () => screen.getByRole('button', { name: en.intake.next });

describe('mission intake', () => {
  beforeEach(() => {
    api.install();
    router.reset();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Testing Library settles each interaction on a zero timeout, which it advances only for the
    // fake timers it recognises — Jest's. Vitest's are the same clock under another name.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
    window.history.replaceState(null, '', '/missions/new');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('saving as the customer goes', () => {
    it('creates nothing by opening, and creates the draft with the first answer', async () => {
      api.on('POST /missions/me', 201, saved({ title: 'Check a supplier' }));
      open();
      expect(heading()).toHaveTextContent(en.intake.need.question);
      expect(screen.getByText('Question 1 of 9')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: en.intake.progress_label })).toHaveAttribute(
        'aria-valuenow',
        String(100 / 9),
      );
      await user().type(screen.getByLabelText(en.intake.need.title), 'Check a supplier');
      expect(api.calls).toEqual([]);

      await pause();
      expect(writes()).toMatchObject([
        { method: 'POST', path: '/missions/me', body: { title: 'Check a supplier' } },
      ]);
      // The address moves to the draft, so a reload opens it where it stands.
      expect(window.location.pathname + window.location.search).toBe(`/missions/${ID}?step=need`);
      expect(screen.getByRole('status')).toHaveTextContent(en.intake.saved);
    });

    it('saves one change at a time, each with the version the last one returned', async () => {
      const release = api.hold('POST /missions/me', 201, saved({ title: 'A' }));
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open();
      const u = user();
      await u.type(screen.getByLabelText(en.intake.need.title), 'A');
      await pause();
      expect(screen.getByRole('status')).toHaveTextContent(en.intake.saving);
      await u.type(screen.getByLabelText(en.intake.need.description), 'More');
      await pause();
      // The edit waits for the draft to exist rather than racing it.
      expect(writes()).toHaveLength(1);

      await act(async () => release());
      expect(writes()).toMatchObject([
        { method: 'POST' },
        { method: 'PATCH', path: `/missions/me/${ID}`, body: { description: 'More', version: 1 } },
      ]);
    });

    it('sends what was typed before moving on, without waiting for the pause', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved({ title: 'Check', description: null }), 'need');
      await user().type(screen.getByLabelText(en.intake.need.description), 'Who owns it');
      await user().click(next());
      expect(writes()).toMatchObject([
        { method: 'PATCH', body: { description: 'Who owns it', version: 1 } },
      ]);
      expect(await arrive(en.intake.kind.question)).toHaveFocus();
      expect(window.location.search).toBe('?step=kind');
    });

    it('sends an emptied answer as no answer — never as empty text, which the API refuses', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved({ title: 'A' }), 'need');
      await user().clear(screen.getByLabelText(en.intake.need.title));
      await pause();
      expect(writes()[0]!.body).toEqual({ title: null, version: 1 });
    });

    it('keeps a change that failed to save, sends it with the next, and does not move on meanwhile', async () => {
      api.on(`PATCH /missions/me/${ID}`, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      open(saved({ description: 'x' }), 'need');
      const u = user();
      await u.type(screen.getByLabelText(en.intake.need.title), 'A');
      await u.click(next());
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
      expect(heading()).toHaveTextContent(en.intake.need.question);

      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      await u.type(screen.getByLabelText(en.intake.need.description), 'y');
      await pause();
      expect(writes().at(-1)!.body).toEqual({ title: 'A', description: 'xy', version: 1 });
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('says so when the draft was changed somewhere else', async () => {
      api.on(
        `PATCH /missions/me/${ID}`,
        409,
        apiError('STATE_CONFLICT', 'error.common.state_conflict'),
      );
      open(saved(), 'need');
      await user().type(screen.getByLabelText(en.intake.need.title), 'A');
      await pause();
      expect(await screen.findByRole('alert')).toHaveTextContent(en.intake.conflict);
    });

    it('treats no response at all as a failure it can say something about', async () => {
      api.down(`PATCH /missions/me/${ID}`);
      open(saved(), 'need');
      await user().type(screen.getByLabelText(en.intake.need.title), 'A');
      await pause();
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    });

    it('sends what is waiting when the tab is hidden, and when the intake is left', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      const { unmount } = open(saved(), 'need');
      const u = user();
      await u.type(screen.getByLabelText(en.intake.need.title), 'A');
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
      expect(writes()).toHaveLength(1);

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await u.type(screen.getByLabelText(en.intake.need.title), 'B');
      await act(async () => unmount());
      expect(writes().map((w) => w.body)).toEqual([
        { title: 'A', version: 1 },
        { title: 'AB', version: 2 },
      ]);
    });

    it('lets the customer finish later, once what they typed is saved', async () => {
      api.on(`PATCH /missions/me/${ID}`, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      open(saved(), 'need');
      const u = user();
      await u.type(screen.getByLabelText(en.intake.need.title), 'A');
      await u.click(screen.getByRole('button', { name: en.intake.later }));
      await screen.findByRole('alert');
      expect(router.push).not.toHaveBeenCalled();

      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      await u.click(screen.getByRole('button', { name: en.intake.later }));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/missions'));
    });
  });

  describe('moving between questions', () => {
    it('does not move on with an answer missing, and takes the customer to it', async () => {
      open();
      await user().click(next());
      expect(heading()).toHaveTextContent(en.intake.need.question);
      const title = screen.getByLabelText(en.intake.need.title);
      expect(title).toHaveAttribute('aria-invalid', 'true');
      expect(title).toHaveAccessibleDescription(
        `${en.intake.need.title_hint} ${en.intake.required}`,
      );
      expect(title).toHaveFocus();
      expect(api.calls).toEqual([]);
    });

    it('goes back a question, and clears what it flagged', async () => {
      open(saved({ title: 'A', description: 'B' }), 'kind');
      const u = user();
      await u.click(next());
      expect(screen.getByText(en.intake.kind.required)).toBeInTheDocument();
      await u.click(screen.getByRole('button', { name: en.intake.back }));
      await arrive(en.intake.need.question);
      expect(screen.queryByRole('button', { name: en.intake.back })).toBeNull();
      expect(screen.queryByText(en.intake.required)).toBeNull();
    });

    it('keeps a new mission’s address until it is saved', async () => {
      open(null, 'budget');
      await user().click(screen.getByRole('button', { name: en.intake.back }));
      await arrive(en.intake.when.question);
      expect(window.location.pathname + window.location.search).toBe('/missions/new?step=when');
      expect(api.calls).toEqual([]);
    });

    it('opens a draft at its first unanswered question', () => {
      open(saved({ title: 'A', description: 'B', taxonomyNodeId: DD }));
      expect(heading()).toHaveTextContent(en.intake.where.question);
    });

    it('opens a complete draft at the brief, and a step the address names wherever it is', () => {
      open(ownMission());
      expect(heading()).toHaveTextContent(en.intake.review.question);
      document.body.innerHTML = '';
      open(ownMission(), 'budget');
      expect(heading()).toHaveTextContent(en.intake.budget.question);
    });
  });

  describe('each question', () => {
    it('kind: a searchable list, parents above their children', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved(), 'kind');
      const u = user();
      const list = screen.getByRole('listbox');
      expect(
        within(list)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Corporate', 'Due diligence', 'Deep checks']);
      await u.type(screen.getByRole('combobox'), 'zzz');
      expect(screen.getByText(en.intake.kind.none)).toBeInTheDocument();
      await u.clear(screen.getByRole('combobox'));
      await u.type(screen.getByRole('combobox'), 'dilig');
      await u.click(screen.getByRole('option', { name: 'Due diligence' }));
      await pause();
      expect(writes()[0]!.body).toEqual({ taxonomyNodeId: DD, version: 1 });
    });

    it('kind: says a mission cannot be sent yet when there is nothing to choose from', () => {
      open(saved(), 'kind', { categories: [] });
      expect(screen.getByText(en.intake.kind.unavailable)).toBeInTheDocument();
    });

    it('where: a country from the list, and a place only as precise as needed', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved(), 'where');
      const u = user();
      await u.click(next());
      expect(screen.getByLabelText(en.intake.where.country)).toHaveAccessibleDescription(
        en.intake.required,
      );
      await u.selectOptions(screen.getByLabelText(en.intake.where.country), 'GE');
      await u.type(screen.getByLabelText(en.intake.where.place), 'Tbilisi');
      await pause();
      expect(writes()[0]!.body).toEqual({
        countryCode: 'GE',
        locationLabel: 'Tbilisi',
        version: 1,
      });
    });

    it('when: not in the past; a start after the finish is said, kept, and not sent until fixed', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved({ deadline: '2026-10-10' }), 'when');
      const u = user();
      const finish = screen.getByLabelText(en.intake.when.deadline);
      const start = screen.getByLabelText(en.intake.when.start);
      expect(finish).toHaveAttribute('min', '2026-09-25');

      await u.type(start, '2026-10-20');
      await pause();
      expect(start).toHaveAccessibleDescription(
        `${en.intake.when.start_hint} ${en.intake.when.order}`,
      );
      expect(writes()).toEqual([]);
      await u.click(next());
      expect(heading()).toHaveTextContent(en.intake.when.question);

      await u.clear(finish);
      await u.type(finish, '2026-10-30');
      await pause();
      // The pair goes whole, now that it can be stored.
      expect(writes()[0]!.body).toEqual({
        startBy: '2026-10-20',
        deadline: '2026-10-30',
        version: 1,
      });
    });

    it('when: the finish date is required, the start is not', async () => {
      open(saved(), 'when');
      await user().click(next());
      expect(screen.getByLabelText(en.intake.when.deadline)).toHaveAccessibleDescription(
        en.intake.required,
      );
      expect(screen.getByLabelText(en.intake.when.start)).toHaveAccessibleDescription(
        en.intake.when.start_hint,
      );
    });

    it('budget: flags a missing currency, and clearing it counts the amounts in hundredths', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved({ currency: 'JPY', budgetMinMinor: 100, budgetMaxMinor: 200 }), 'budget');
      const u = user();
      await u.selectOptions(screen.getByLabelText(en.intake.budget.currency), '');
      await pause();
      expect(writes()[0]!.body).toEqual({
        currency: null,
        budgetMinMinor: 10_000,
        budgetMaxMinor: 20_000,
        version: 1,
      });
      await u.click(next());
      expect(screen.getByLabelText(en.intake.budget.currency)).toHaveAccessibleDescription(
        en.intake.required,
      );
    });

    it('budget: whole amounts in the currency’s own minor units', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved(), 'budget');
      const u = user();
      await u.selectOptions(screen.getByLabelText(en.intake.budget.currency), 'USD');
      await u.type(screen.getByLabelText(en.intake.budget.min), '250.50');
      await u.type(screen.getByLabelText(en.intake.budget.max), '1000');
      await pause();
      expect(writes().at(-1)!.body).toEqual({
        currency: 'USD',
        budgetMinMinor: 25_050,
        budgetMaxMinor: 100_000,
        version: 1,
      });

      // The same amounts in yen, which has no minor unit.
      await u.selectOptions(screen.getByLabelText(en.intake.budget.currency), 'JPY');
      await pause();
      expect(writes().at(-1)!.body).toMatchObject({
        currency: 'JPY',
        budgetMinMinor: 251,
        budgetMaxMinor: 1000,
      });
      expect(screen.getByLabelText(en.intake.budget.min)).toHaveAttribute('inputmode', 'numeric');
    });

    it('budget: an amount it cannot read, or the wrong way round, is said and not sent', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved({ currency: 'AMD', budgetMinMinor: 10_000, budgetMaxMinor: 50_000 }), 'budget');
      const u = user();
      const min = screen.getByLabelText(en.intake.budget.min);
      expect(min).toHaveValue('100');
      await u.clear(min);
      await u.type(min, 'lots');
      expect(min).toHaveAccessibleDescription(en.intake.budget.amount);

      await u.clear(min);
      await u.type(min, '900');
      await pause();
      expect(screen.getByText(en.intake.budget.order)).toBeInTheDocument();
      await u.click(next());
      expect(heading()).toHaveTextContent(en.intake.budget.question);
      // Nothing typed on the way — not "lots" as no answer, not "90" — and never the inverted pair.
      expect(writes()).toEqual([]);

      await u.clear(min);
      await u.type(min, '150');
      await pause();
      expect(writes().map((w) => w.body)).toEqual([
        { currency: 'AMD', budgetMinMinor: 15_000, budgetMaxMinor: 50_000, version: 1 },
      ]);
    });

    it('budget: an empty amount is no answer, flagged on moving on', async () => {
      open(saved({ currency: 'AMD' }), 'budget');
      await user().click(next());
      expect(screen.getByLabelText(en.intake.budget.max)).toHaveAccessibleDescription(
        en.intake.required,
      );
    });

    it('languages: starts with the reader’s own, which can be removed like any other', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved(), 'languages');
      const u = user();
      const chosen = screen.getByRole('list', { name: en.intake.languages.chosen });
      expect(within(chosen).getByText('English')).toBeInTheDocument();
      await pause();
      expect(writes()[0]!.body).toEqual({ languages: ['en'], version: 1 });

      const add = screen.getByRole('button', { name: en.intake.languages.add_button });
      expect(add).toBeDisabled();
      expect(
        within(screen.getByLabelText(en.intake.languages.add)).queryByText('English'),
      ).toBeNull();
      await u.selectOptions(screen.getByLabelText(en.intake.languages.add), 'hy');
      await u.click(add);
      await u.click(screen.getByRole('button', { name: 'Remove English' }));
      await pause();
      expect(writes().at(-1)!.body).toEqual({ languages: ['hy'], version: 2 });
      await u.click(screen.getByRole('button', { name: 'Remove Armenian' }));
      await u.click(next());
      expect(screen.getByText(en.intake.languages.required)).toBeInTheDocument();
    });

    it('languages: keeps a draft’s own list, and names a code it has no name for by the code', () => {
      open(saved({ languages: ['xx'] }), 'languages');
      expect(screen.getByRole('button', { name: 'Remove xx' })).toBeInTheDocument();
    });

    it('languages: no more than ten', () => {
      open(
        saved({ languages: ['aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av'] }),
        'languages',
        { languages: [...OPTIONS.languages] },
      );
      expect(screen.getByRole('button', { name: en.intake.languages.add_button })).toBeDisabled();
    });

    it('who: asks about a protective order only where the relationship is personal', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved(), 'who');
      const u = user();
      await u.click(next());
      expect(screen.getByRole('radiogroup', { name: en.intake.who.relationship })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(
        screen.getByRole('radio', { name: en.brief.relationship.SELF_OR_OWN_ORGANISATION }),
      ).toHaveFocus();
      await u.click(screen.getByRole('radio', { name: en.brief.relationship.EMPLOYER }));
      expect(screen.queryByRole('radiogroup', { name: en.intake.who.protective })).toBeNull();

      await u.click(screen.getByRole('radio', { name: en.brief.relationship.FORMER_PARTNER }));
      await u.click(next());
      expect(heading()).toHaveTextContent(en.intake.who.question);
      const order = screen.getByRole('radiogroup', { name: en.intake.who.protective });
      await u.click(within(order).getByRole('radio', { name: en.intake.who.yes }));
      await u.click(within(order).getByRole('radio', { name: en.intake.who.no }));
      await u.click(next());
      await arrive(en.intake.why.question);
      expect(writes().at(-1)!.body).toEqual({
        subjectRelationship: 'FORMER_PARTNER',
        protectiveOrderDeclared: false,
        version: 1,
      });
    });

    it('who: shows an answer already given', () => {
      open(saved({ subjectRelationship: 'FAMILY_MEMBER', protectiveOrderDeclared: true }), 'who');
      expect(screen.getByRole('radio', { name: en.intake.who.yes })).toBeChecked();
    });

    it('why: the reason in the customer’s own words', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, saved({ version: 2 }));
      open(saved(), 'why');
      const u = user();
      await u.click(next());
      expect(screen.getByLabelText(en.intake.why.purpose)).toHaveAttribute('aria-invalid', 'true');
      await u.type(screen.getByLabelText(en.intake.why.purpose), 'A contract.');
      await pause();
      expect(writes()[0]!.body).toEqual({ purpose: 'A contract.', version: 1 });
    });
  });

  describe('the brief, and sending it', () => {
    it('shows every answer by name, each with the way back to its question', async () => {
      open(ownMission(), 'review');
      const brief = document.querySelector('dl')!;
      expect(brief).toHaveTextContent('Check a supplier before we sign');
      expect(brief).toHaveTextContent('Due diligence');
      expect(brief).toHaveTextContent('ArmeniaYerevan');
      expect(brief).toHaveTextContent('Finished by Oct 16, 2026');
      expect(brief).toHaveTextContent('Armenian, English');
      expect(brief).toHaveTextContent(en.brief.relationship.BUSINESS_RELATIONSHIP);
      await user().click(screen.getByRole('button', { name: 'Change: Budget' }));
      await arrive(en.intake.budget.question);
    });

    it.each([
      [
        { subjectRelationship: 'FAMILY_MEMBER', protectiveOrderDeclared: true },
        en.brief.protective_yes,
      ],
      [
        { subjectRelationship: 'PARTNER_OR_SPOUSE', protectiveOrderDeclared: false },
        en.brief.protective_no,
      ],
    ] as const)('says whether a protective order stands, where it was asked', (over, words) => {
      open(ownMission({ ...over, startBy: '2026-10-01' }), 'review');
      const brief = document.querySelector('dl')!;
      expect(brief).toHaveTextContent(words);
      expect(brief).toHaveTextContent('Not before Oct 1, 2026');
    });

    it('says nothing of a protective order not yet answered', () => {
      open(ownMission({ subjectRelationship: 'FORMER_PARTNER' }), 'review');
      const brief = document.querySelector('dl')!;
      expect(brief).toHaveTextContent(en.brief.relationship.FORMER_PARTNER);
      expect(brief).not.toHaveTextContent(en.brief.protective_no);
    });

    it('marks what is unanswered, and sends nothing, when asked to send too soon', async () => {
      open(saved({ title: 'A' }), 'review');
      const u = user();
      expect(screen.getAllByText(en.brief.not_answered)).toHaveLength(7);
      await u.click(screen.getByRole('button', { name: en.intake.review.send }));
      expect(screen.getByRole('alert')).toHaveTextContent(en.intake.review.incomplete);
      expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
        en.intake.review.confirm_required,
      );
      expect(api.calls).toEqual([]);
    });

    it('needs the customer’s own confirmation before sending', async () => {
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('button', { name: en.intake.review.send }));
      expect(screen.getByText(en.intake.review.confirm_required)).toBeInTheDocument();
      expect(api.calls).toEqual([]);
      expect(screen.getByRole('link', { name: en.intake.review.policy })).toHaveAttribute(
        'href',
        '/help/kb-policy-prohibited-requests',
      );
    });

    it('sends it for review with the confirmation and the version, then shows where it stands', async () => {
      api.on(`POST /missions/me/${ID}/submit`, 200, ownMission({ status: 'UNDER_REVIEW' }));
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('checkbox', { name: en.intake.review.confirm }));
      await u.click(screen.getByRole('button', { name: en.intake.review.send }));
      expect(writes()).toMatchObject([
        { path: `/missions/me/${ID}/submit`, body: { version: 3, lawfulPurposeConfirmed: true } },
      ]);
      await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/missions/${ID}`));
    });

    it('saves what is waiting before sending, and sends the version that save returned', async () => {
      api.on(`PATCH /missions/me/${ID}`, 200, ownMission({ version: 4 }));
      api.on(`POST /missions/me/${ID}/submit`, 200, ownMission({ status: 'UNDER_REVIEW' }));
      open(ownMission(), 'why');
      const u = user();
      await u.type(screen.getByLabelText(en.intake.why.purpose), '!');
      await u.click(next());
      await u.click(await screen.findByRole('checkbox'));
      await u.click(screen.getByRole('button', { name: en.intake.review.send }));
      await waitFor(() =>
        expect(writes().at(-1)!.body).toEqual({ version: 4, lawfulPurposeConfirmed: true }),
      );
    });

    it('does not send when saving what is waiting fails', async () => {
      api.on(`PATCH /missions/me/${ID}`, 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('button', { name: 'Change: Why you need it' }));
      await u.type(await screen.findByLabelText(en.intake.why.purpose), '!');
      // Moving on fails with the save, so the brief is reached only once it is saved.
      await u.click(next());
      await screen.findByRole('alert');
      expect(heading()).toHaveTextContent(en.intake.why.question);
    });

    it('lists what the API found missing, each with the way to the question that fixes it', async () => {
      api.on(
        `POST /missions/me/${ID}/submit`,
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
          details: [
            {
              field: 'deadline',
              code: 'IN_THE_PAST',
              messageKey: 'error.validation.mission.deadline_past',
            },
            {
              field: 'taxonomyNodeId',
              code: 'UNAVAILABLE',
              messageKey: 'error.validation.mission.category_unavailable',
            },
            { field: 'countryCode', code: 'ODD', messageKey: 'error.validation.unknown' },
            { field: 'location', code: 'ODD', messageKey: 'error.validation.unknown' },
          ],
        }),
      );
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('checkbox'));
      await u.click(screen.getByRole('button', { name: en.intake.review.send }));
      const refused = await screen.findByRole('alert');
      expect(refused).toHaveTextContent(en.intake.review.refused);
      const items = within(refused).getAllByRole('listitem');
      expect(items.map((i) => i.firstChild!.textContent)).toEqual([
        `When — ${catalogs.en.error.validation.mission.deadline_past}`,
        `Kind of help — ${catalogs.en.error.validation.mission.category_unavailable}`,
        `Where — ${catalogs.en.error.validation.mission.required}`,
      ]);
      await u.click(within(items[0]!).getByRole('button', { name: 'Change: When' }));
      await arrive(en.intake.when.question);
    });

    it('says so when the mission changed while it was being sent', async () => {
      api.on(
        `POST /missions/me/${ID}/submit`,
        409,
        apiError('STATE_CONFLICT', 'error.common.state_conflict'),
      );
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('checkbox'));
      await u.click(screen.getByRole('button', { name: en.intake.review.send }));
      expect(await screen.findByRole('alert')).toHaveTextContent(en.intake.conflict);
      expect(router.push).not.toHaveBeenCalled();
    });

    it('sends once, however often it is pressed', async () => {
      const release = api.hold(`POST /missions/me/${ID}/submit`, 200, ownMission());
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('checkbox'));
      const send = screen.getByRole('button', { name: en.intake.review.send });
      await u.click(send);
      expect(send).toBeDisabled();
      await act(async () => release());
      expect(writes()).toHaveLength(1);
    });

    it('reports no response at all as something went wrong', async () => {
      api.down(`POST /missions/me/${ID}/submit`);
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('checkbox'));
      await u.click(screen.getByRole('button', { name: en.intake.review.send }));
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    });

    it('can be un-ticked', async () => {
      open(ownMission(), 'review');
      const u = user();
      await u.click(screen.getByRole('checkbox'));
      await u.click(screen.getByRole('checkbox'));
      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });
  });

  describe('a draft a reviewer returned', () => {
    it('opens at the brief with the reviewer’s note, and keeps it on every question', async () => {
      open(
        ownMission({
          review: {
            outcome: 'CHANGES_REQUESTED',
            reason: 'Say which city the work is in.',
            decidedAt: '2026-09-24T10:00:00.000Z',
          },
        }),
      );
      expect(heading()).toHaveTextContent(en.intake.review.question);
      const note = screen.getByText(en.intake.returned.title).closest('[data-slot=alert]')!;
      expect(note).toHaveTextContent('Say which city the work is in.');
      await user().click(screen.getByRole('button', { name: 'Change: Where' }));
      await arrive(en.intake.where.question);
      expect(screen.getByText('Say which city the work is in.')).toBeInTheDocument();
    });

    it('says it came back even when the reviewer wrote no note', () => {
      open(
        ownMission({
          review: {
            outcome: 'CHANGES_REQUESTED',
            reason: null,
            decidedAt: '2026-09-24T10:00:00.000Z',
          },
        }),
      );
      expect(screen.getByText(en.intake.returned.body)).toBeInTheDocument();
      expect(document.querySelector('blockquote')).toBeNull();
    });
  });
});
