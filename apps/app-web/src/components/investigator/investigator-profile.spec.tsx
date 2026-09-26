import { catalogs, formatBudget } from '@investigator/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { ownProfile, serviceArea } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { AvailabilityEditor, fromClock, toClock } from './availability-editor';
import { DetailsForm } from './details-form';
import { LanguagesEditor } from './languages-editor';
import { PublicProfileCard } from './public-profile-card';
import { SectionCard } from '@/components/section-card';
import { coarse, RADII, ServiceAreas } from './service-areas';
import { SpecialtiesPicker } from './specialties-picker';
import { StatusCard } from './status-card';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.investigator;
const DD = '5f51f336-5c7a-442a-909f-8d54d5abf81b';
const SPECIALTIES = [[DD, 'Due diligence']] as const;
const PATCH = 'PATCH /profiles/investigator/me';
const patched = () => api.calls.find((c) => c.method === 'PATCH')!.body;
const user = () => userEvent.setup();

beforeEach(() => {
  api.install();
  router.reset();
});

describe('a section of the profile page', () => {
  it('is a region named by its title, reachable by its id, with what it is for', () => {
    renderIntl(
      <SectionCard id="languages" title="Languages" body="What you work in.">
        <p>inside</p>
      </SectionCard>,
    );
    const region = screen.getByRole('region', { name: 'Languages' });
    expect(region).toHaveAttribute('id', 'languages');
    expect(region).toHaveTextContent('What you work in.');
    expect(region).toHaveTextContent('inside');
  });

  it('has no description unless given one', () => {
    renderIntl(
      <SectionCard id="x" title="T">
        <p>inside</p>
      </SectionCard>,
    );
    expect(screen.getByRole('region', { name: 'T' }).querySelectorAll('p')).toHaveLength(1);
  });
});

describe('where the profile stands', () => {
  const status = (profile = ownProfile(), areas = 1) =>
    renderIntl(
      <StatusCard profile={profile} preview={profile} areas={areas} specialties={SPECIALTIES} />,
    );
  const checklist = () =>
    within(screen.getByRole('region', { name: en.status.title }))
      .getAllByRole('link')
      .map((a) => [a.textContent, a.getAttribute('href')]);

  it('lists what is still to do, each item linking to where it is done', () => {
    status(
      ownProfile({
        visibility: 'DRAFT',
        verificationStatus: 'UNVERIFIED',
        acceptingWork: false,
        languages: [],
        specialtyNodeIds: [],
      }),
      0,
    );
    expect(screen.getByText(en.status.body)).toBeVisible();
    expect(screen.getByText(en.verification_status.UNVERIFIED)).toHaveAttribute(
      'data-variant',
      'outline',
    );
    expect(checklist()).toEqual([
      [`${en.status.published}${en.status.todo}`, '#status'],
      [`${en.status.verified}${en.status.todo}`, '#verification'],
      [`${en.status.accepting}${en.status.todo}`, '#status'],
      [`${en.status.languages}${en.status.todo}`, '#languages'],
      [`${en.status.specialties}${en.status.todo}`, '#specialties'],
      [`${en.status.areas}${en.status.todo}`, '#areas'],
    ]);
  });

  it('says the investigator is listed once everything is done', () => {
    status();
    expect(screen.getByText(en.status.ready)).toBeVisible();
    expect(screen.queryByText(en.status.body)).toBeNull();
    expect(screen.getByText(en.verification_status.VERIFIED)).toHaveAttribute(
      'data-variant',
      'default',
    );
    expect(checklist().every(([text]) => text!.endsWith(en.status.done))).toBe(true);
  });

  it.each([
    [en.status.publish, ownProfile(), { visibility: 'DRAFT' }],
    [en.status.publish, ownProfile({ visibility: 'DRAFT' }), { visibility: 'PUBLISHED' }],
    [en.status.accept, ownProfile(), { acceptingWork: false }],
    [en.status.accept, ownProfile({ acceptingWork: false }), { acceptingWork: true }],
  ])('flips "%s" and saves it at once (%#)', async (name, profile, body) => {
    api.on(PATCH, 200, {});
    status(profile);
    await user().click(screen.getByRole('switch', { name }));
    expect(api.calls).toMatchObject([{ method: 'PATCH', body }]);
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole('switch', { name })).toBeEnabled();
  });

  it('says why a switch did not save, including when the API cannot be reached', async () => {
    api.on(PATCH, 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    status();
    await user().click(screen.getByRole('switch', { name: en.status.publish }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.auth.forbidden);
    expect(router.refresh).not.toHaveBeenCalled();

    api.down(PATCH);
    await user().click(screen.getByRole('switch', { name: en.status.accept }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
  });

  it('previews exactly what a customer sees, and closes', async () => {
    status();
    await user().click(screen.getByRole('button', { name: en.status.preview }));
    const preview = await screen.findByRole('dialog', { name: en.status.preview_title });
    expect(preview).toHaveTextContent(en.status.preview_body);
    expect(within(preview).getByRole('heading', { name: 'Ani Petrosyan' })).toBeVisible();
    expect(preview).toHaveTextContent('Due diligence');
    expect(preview).not.toHaveTextContent('+37410000000');
    await user().click(within(preview).getByRole('button', { name: en.status.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the public profile', () => {
  const card = (profile = ownProfile()) =>
    renderIntl(<PublicProfileCard profile={profile} specialties={new Map(SPECIALTIES)} />);

  it('shows every public field, in the reader’s language', () => {
    card(
      ownProfile({
        specialtyNodeIds: [DD, 'retired-node'],
        languages: [
          { languageCode: 'hy', proficiency: 'NATIVE' },
          { languageCode: 'en', proficiency: 'FLUENT' },
        ],
        availability: [
          { dayOfWeek: 2, startMinute: 600, endMinute: 900 },
          { dayOfWeek: 0, startMinute: 840, endMinute: 1080 },
          { dayOfWeek: 0, startMinute: 540, endMinute: 720 },
        ],
      }),
    );
    const article = screen.getByRole('article', { name: 'Ani Petrosyan' });
    expect(article).toHaveTextContent('Corporate due diligence in the Caucasus');
    expect(article).toHaveTextContent(en.status.accepting);
    expect(article).toHaveTextContent('10 years of experience');
    expect(article).toHaveTextContent('Ten years of company checks.');
    // A specialty no longer in the tree is shown by its id rather than dropped.
    expect(
      within(article).getByRole('list', { name: en.specialties.title }).querySelectorAll('li'),
    ).toHaveLength(2);
    expect(article).toHaveTextContent('retired-node');
    const languages = within(article).getByRole('list', { name: en.languages.title });
    expect(
      within(languages)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Armenian Native', 'English Fluent']);
    expect(article).toHaveTextContent(
      `By the hour${formatBudget(2_500_000, 'AMD', 'en').replace(/\s/g, ' ')} an hour`,
    );
    expect(article).toHaveTextContent('Mon 09:00–12:00, Mon 14:00–18:00, Wed 10:00–15:00');
  });

  it('leaves out what is not set, and names nobody when there is no name', () => {
    card(
      ownProfile({
        displayName: null,
        headline: null,
        bio: null,
        yearsExperience: null,
        acceptingWork: false,
        verified: false,
        specialtyNodeIds: [],
        languages: [],
        pricingModel: null,
        availability: [],
      }),
    );
    const article = screen.getByRole('article', { name: en.details.not_set });
    expect(article.querySelectorAll('[data-slot=badge]')).toHaveLength(0);
    expect(article.querySelectorAll('p')).toHaveLength(0);
    expect(within(article).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('says a verified investigator is verified, and names them only where the page does not', () => {
    const { unmount } = card();
    const article = screen.getByRole('article', { name: 'Ani Petrosyan' });
    expect(within(article).getByText(en.verification_status.VERIFIED)).toBeVisible();
    unmount();
    renderIntl(
      <PublicProfileCard profile={ownProfile()} specialties={new Map(SPECIALTIES)} named={false} />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('article')).not.toHaveAttribute('aria-labelledby');
    expect(screen.getByRole('article')).toHaveTextContent(en.verification_status.VERIFIED);
  });

  it.each([
    ['no rate', { hourlyRateMinor: null }],
    ['no currency', { currency: null }],
  ])('names the pricing model alone with %s', (_, over) => {
    card(ownProfile({ pricingModel: 'FIXED_FEE', ...over }));
    expect(screen.getByText(en.details.pricing_FIXED_FEE)).toBeVisible();
    expect(screen.getByRole('article')).not.toHaveTextContent('an hour');
  });
});

describe('about the investigator', () => {
  const CURRENCIES = ['AMD', 'EUR', 'USD'];
  const form = (profile = ownProfile({ verificationStatus: 'UNVERIFIED' })) =>
    renderIntl(<DetailsForm profile={profile} currencies={CURRENCIES} />);
  const save = () => user().click(screen.getByRole('button', { name: en.details.save }));

  it('saves everything together, the name while it is not verified', async () => {
    api.on(PATCH, 200, {});
    form();
    const name = screen.getByRole('textbox', { name: en.details.name });
    expect(name).toHaveAccessibleDescription(en.details.name_hint);
    await user().clear(name);
    await user().type(name, '  Ani Grigoryan ');
    await user().type(screen.getByRole('textbox', { name: en.details.headline }), '!');
    await user().selectOptions(
      screen.getByRole('combobox', { name: en.details.pricing }),
      'RETAINER',
    );
    await user().selectOptions(screen.getByRole('combobox', { name: en.details.currency }), 'USD');
    const rate = screen.getByRole('textbox', { name: en.details.rate });
    expect(rate).toHaveValue('25000');
    await user().clear(rate);
    await user().type(rate, '150.5');
    await save();
    expect(patched()).toEqual({
      displayName: 'Ani Grigoryan',
      headline: 'Corporate due diligence in the Caucasus!',
      bio: 'Ten years of company checks.\nCourt and registry work.',
      contactPhone: '+37410000000',
      yearsExperience: 10,
      pricingModel: 'RETAINER',
      hourlyRateMinor: 15_050,
      currency: 'USD',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(en.details.saved);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('clears what was emptied, and sends nothing for what was never set', async () => {
    api.on(PATCH, 200, {});
    form(
      ownProfile({
        verificationStatus: 'REJECTED',
        displayName: null,
        headline: null,
        bio: null,
        contactPhone: null,
        yearsExperience: null,
        pricingModel: null,
        hourlyRateMinor: null,
        currency: null,
      }),
    );
    expect(screen.getByRole('textbox', { name: en.details.rate })).toHaveValue('');
    // Submitted past the browser's own check, which a blank name would stop.
    fireEvent.submit(screen.getByRole('button', { name: en.details.save }).closest('form')!);
    await screen.findByRole('status');
    expect(patched()).toEqual({ headline: '', bio: '', contactPhone: '' });
  });

  it.each(['VERIFIED', 'PENDING'] as const)(
    'shows a %s name without offering to change it, and never sends it',
    async (verificationStatus) => {
      api.on(PATCH, 200, {});
      form(ownProfile({ verificationStatus }));
      const name = screen.getByRole('textbox', { name: en.details.name });
      expect(name).toHaveAttribute('readonly');
      expect(name).not.toBeRequired();
      expect(name).toHaveAccessibleDescription(en.details.name_locked);
      await save();
      expect(patched()).not.toHaveProperty('displayName');
    },
  );

  it('shows a rate with no currency as a plain amount', () => {
    form(ownProfile({ currency: null, hourlyRateMinor: 1_000 }));
    expect(screen.getByRole('textbox', { name: en.details.rate })).toHaveValue('10');
  });

  it('puts the API’s refusal of the name under the name', async () => {
    api.on(
      PATCH,
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
        details: [
          {
            field: 'displayName',
            code: 'LOCKED',
            messageKey: 'error.validation.display_name.locked',
          },
        ],
      }),
    );
    form();
    await save();
    const name = screen.getByRole('textbox', { name: en.details.name });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(
      `${en.details.name_hint} ${catalogs.en.error.validation.display_name.locked}`,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('languages', () => {
  const OPTIONS = [
    { code: 'en', name: 'English' },
    { code: 'hy', name: 'Armenian' },
    { code: 'ru', name: 'Russian' },
  ];
  const editor = (languages = ownProfile().languages) =>
    renderIntl(<LanguagesEditor languages={languages} options={OPTIONS} />);

  it('adds, re-levels and removes, then saves the whole set', async () => {
    api.on(PATCH, 200, {});
    editor([
      { languageCode: 'hy', proficiency: 'NATIVE' },
      { languageCode: 'xx', proficiency: 'BASIC' },
    ]);
    // A code no longer offered is still shown, by its code, so it can be removed.
    await user().click(screen.getByRole('button', { name: 'Remove xx' }));
    const add = screen.getByRole('button', { name: en.languages.add });
    expect(add).toBeDisabled();
    const picker = screen.getByRole('combobox', { name: en.languages.add });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([en.languages.language, 'English', 'Russian']);
    await user().selectOptions(picker, 'ru');
    await user().click(add);
    expect(picker).toHaveValue('');
    await user().selectOptions(
      screen.getByRole('combobox', { name: `${en.languages.level} — Russian` }),
      'CONVERSATIONAL',
    );
    await user().click(screen.getByRole('button', { name: en.languages.save }));
    expect(patched()).toEqual({
      languages: [
        { languageCode: 'hy', proficiency: 'NATIVE' },
        { languageCode: 'ru', proficiency: 'CONVERSATIONAL' },
      ],
    });
    expect(await screen.findByRole('status')).toHaveTextContent(en.languages.saved);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says there are none, and saves none', async () => {
    api.on(PATCH, 422, apiError('VALIDATION_FAILED', 'error.common.validation_failed'));
    editor([]);
    expect(screen.getByText(en.languages.empty)).toBeVisible();
    await user().click(screen.getByRole('button', { name: en.languages.save }));
    expect(patched()).toEqual({ languages: [] });
    expect(await screen.findByRole('alert')).toBeVisible();
  });
});

describe('specialties', () => {
  const CATEGORIES = [
    { id: 'corp', label: 'Corporate', depth: 0 },
    { id: DD, label: 'Due diligence', depth: 1 },
    { id: 'deep', label: 'Supplier checks', depth: 2 },
    { id: 'family', label: 'Family', depth: 0 },
  ];
  const picker = (chosen: string[] = [DD]) =>
    renderIntl(<SpecialtiesPicker chosen={chosen} categories={CATEGORIES} />);
  const option = (name: RegExp) => screen.getByRole('option', { name });

  it('finds by name, toggles each, and saves the set', async () => {
    api.on(PATCH, 200, {});
    picker([DD, 'retired']);
    expect(screen.getByText('2 chosen')).toBeVisible();
    expect(screen.getByText('retired')).toBeVisible();
    expect(option(/Due diligence/)).toHaveAccessibleName(
      `Due diligence ${en.specialties.selected}`,
    );
    await user().type(screen.getByRole('combobox'), 'supp');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user().click(option(/Supplier checks/));
    await user().clear(screen.getByRole('combobox'));
    await user().click(option(/Due diligence/));
    expect(screen.getByText('2 chosen')).toBeVisible();
    await user().click(screen.getByRole('button', { name: en.specialties.save }));
    expect(patched()).toEqual({ specialtyNodeIds: ['retired', 'deep'] });
    expect(await screen.findByRole('status')).toHaveTextContent(en.specialties.saved);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says when nothing matches, and when nothing is chosen', async () => {
    picker([]);
    expect(screen.getByText('None chosen')).toBeVisible();
    await user().type(screen.getByRole('combobox'), 'zzz');
    expect(screen.getByText(en.specialties.none)).toBeVisible();
  });

  it('says why the set did not save', async () => {
    api.on(PATCH, 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    picker();
    await user().click(screen.getByRole('button', { name: en.specialties.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.auth.forbidden);
  });
});

describe('availability', () => {
  const editor = (windows = ownProfile().availability) =>
    renderIntl(<AvailabilityEditor windows={windows} />);
  const save = () => user().click(screen.getByRole('button', { name: en.availability.save }));

  it('turns clock times into minutes and back', () => {
    expect(toClock(0)).toBe('00:00');
    expect(toClock(9 * 60 + 5)).toBe('09:05');
    expect(fromClock('18:30')).toBe(1110);
    // A time input cleared by hand.
    expect(fromClock('')).toBe(0);
  });

  it('lists the windows by day and time, and saves them edited', async () => {
    api.on(PATCH, 200, {});
    editor([
      { dayOfWeek: 4, startMinute: 600, endMinute: 1440 },
      { dayOfWeek: 0, startMinute: 840, endMinute: 1080 },
      { dayOfWeek: 0, startMinute: 540, endMinute: 720 },
    ]);
    const days = screen.getAllByRole('combobox', { name: en.availability.day });
    expect(days.map((d) => (d as HTMLSelectElement).value)).toEqual(['0', '0', '4']);
    // Midnight at the end of the day is shown as the last minute an input can hold.
    expect(screen.getAllByLabelText(en.availability.to).at(-1)).toHaveValue('23:59');
    await user().click(screen.getByRole('button', { name: 'Remove Monday 14:00–18:00' }));
    await user().selectOptions(
      screen.getAllByRole('combobox', { name: en.availability.day })[0]!,
      '1',
    );
    fireEvent.change(screen.getAllByLabelText(en.availability.from)[0]!, {
      target: { value: '08:30' },
    });
    fireEvent.change(screen.getAllByLabelText(en.availability.to)[0]!, {
      target: { value: '12:15' },
    });
    await save();
    expect(patched()).toEqual({
      availability: [
        { dayOfWeek: 1, startMinute: 510, endMinute: 735 },
        { dayOfWeek: 4, startMinute: 600, endMinute: 1440 },
      ],
    });
    expect(await screen.findByRole('status')).toHaveTextContent(en.availability.saved);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('adds working hours day by day, from nothing', async () => {
    editor([]);
    expect(screen.getByText(en.availability.off)).toBeVisible();
    await user().click(screen.getByRole('button', { name: en.availability.add }));
    await user().click(screen.getByRole('button', { name: en.availability.add }));
    expect(
      screen
        .getAllByRole('combobox', { name: en.availability.day })
        .map((d) => (d as HTMLSelectElement).value),
    ).toEqual(['0', '1']);
    expect(
      screen.getAllByLabelText(en.availability.from).map((i) => (i as HTMLInputElement).value),
    ).toEqual(['09:00', '09:00']);
  });

  it('will not save a window that ends before it starts, and says so', async () => {
    api.on(PATCH, 200, {});
    editor();
    fireEvent.change(screen.getByLabelText(en.availability.to), { target: { value: '08:00' } });
    await save();
    expect(screen.getByRole('alert')).toHaveTextContent(en.availability.invalid);
    expect(api.calls).toHaveLength(0);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(screen.getByLabelText(en.availability.to), { target: { value: '19:00' } });
    await save();
    expect(await screen.findByRole('status')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why the hours did not save', async () => {
    api.on(PATCH, 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    editor();
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.auth.forbidden);
  });
});

describe('where the investigator works', () => {
  const COUNTRIES = [
    { code: 'AM', name: 'Armenia' },
    { code: 'GE', name: 'Georgia' },
  ];
  const areas = (list = [serviceArea()]) =>
    renderIntl(<ServiceAreas areas={list} countries={COUNTRIES} />);
  const position = (lon: number, lat: number) =>
    ({ coords: { longitude: lon, latitude: lat } }) as GeolocationPosition;
  /** The device's answer to "where am I": a position, a refusal, or none yet. */
  const device = (answer: GeolocationPosition | 1 | 2 | null) => {
    const getCurrentPosition = vi.fn(
      (ok: PositionCallback, fail: PositionErrorCallback, options: PositionOptions) => {
        void options;
        if (answer === null) return;
        if (typeof answer === 'number') {
          fail({ code: answer, PERMISSION_DENIED: 1 } as GeolocationPositionError);
        } else ok(answer);
      },
    );
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    return getCurrentPosition;
  };
  const locate = () => user().click(screen.getByRole('button', { name: en.areas.locate }));

  it('keeps a position to about a kilometre, on the device', () => {
    expect(coarse(position(44.514_98, 40.182_37))).toEqual({ lon: 44.51, lat: 40.18 });
    expect(RADII).toEqual([5, 10, 25, 50, 100]);
  });

  it('lists each area with its reach and place', () => {
    areas([
      serviceArea(),
      serviceArea({
        id: 'a-2',
        label: 'Drawn',
        kind: 'POLYGON',
        radiusKm: null,
        city: null,
        countryCode: 'XK',
      }),
      serviceArea({ id: 'a-3', label: 'Somewhere', countryCode: null, city: null }),
    ]);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Yerevan15 km around the centre · Yerevan · Armenia',
      `Drawn${en.areas.drawn} · XK`,
      'Somewhere15 km around the centre',
    ]);
  });

  it('says there are none', () => {
    device(null);
    areas([]);
    expect(screen.getByText(en.areas.empty)).toBeVisible();
  });

  it('removes an area, and says why when it cannot', async () => {
    api.on('DELETE /service-areas/me/a-1', 204);
    areas();
    await user().click(screen.getByRole('button', { name: 'Remove Yerevan' }));
    expect(api.calls).toMatchObject([{ method: 'DELETE', path: '/service-areas/me/a-1' }]);
    expect(router.refresh).toHaveBeenCalled();

    api.on('DELETE /service-areas/me/a-1', 404, apiError('NOT_FOUND', 'error.common.not_found'));
    await user().click(screen.getByRole('button', { name: 'Remove Yerevan' }));
    expect(await screen.findByRole('alert')).toBeVisible();
  });

  it('adds an area around the device’s rounded position, sending nothing more precise', async () => {
    const asked = device(position(44.514_98, 40.182_37));
    api.on('POST /service-areas/me', 201, serviceArea());
    areas([]);
    expect(screen.queryByRole('textbox', { name: en.areas.label })).toBeNull();
    await locate();
    expect(asked.mock.calls[0]![2]).toEqual({
      enableHighAccuracy: false,
      timeout: 15_000,
      maximumAge: 600_000,
    });
    expect(screen.getByRole('status')).toHaveTextContent(en.areas.located);
    const radius = screen.getByRole('group', { name: en.areas.radius });
    expect(within(radius).getByRole('radio', { name: '25 km' })).toBeChecked();
    await user().click(within(radius).getByRole('radio', { name: '50 km' }));
    // Tapping the chosen radius again leaves it chosen: there is always one.
    await user().click(within(radius).getByRole('radio', { name: '50 km' }));
    expect(within(radius).getByRole('radio', { name: '50 km' })).toBeChecked();
    await user().type(screen.getByRole('textbox', { name: en.areas.label }), ' Kotayk ');
    await user().selectOptions(screen.getByRole('combobox', { name: en.areas.country }), 'AM');
    await user().type(screen.getByRole('textbox', { name: en.areas.city }), ' Abovyan ');
    await user().click(screen.getByRole('button', { name: en.areas.add }));
    expect(api.calls[0]!.body).toEqual({
      kind: 'RADIUS',
      label: 'Kotayk',
      centre: { lon: 44.51, lat: 40.18 },
      radiusKm: 50,
      countryCode: 'AM',
      city: 'Abovyan',
    });
    expect(router.refresh).toHaveBeenCalled();
    // Ready for the next one.
    expect(screen.queryByRole('textbox', { name: en.areas.label })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sends no country or city when none is named, and says why an area was refused', async () => {
    device(position(44.5, 40.2));
    api.on(
      'POST /service-areas/me',
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
    );
    areas([]);
    await locate();
    await user().type(screen.getByRole('textbox', { name: en.areas.label }), 'Home');
    await user().click(screen.getByRole('button', { name: en.areas.add }));
    expect(api.calls[0]!.body).toEqual({
      kind: 'RADIUS',
      label: 'Home',
      centre: { lon: 44.5, lat: 40.2 },
      radiusKm: 25,
    });
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('textbox', { name: en.areas.label })).toHaveValue('Home');
  });

  it('says what to do about a refused area, not only that something needs correcting (T-135)', async () => {
    device(position(44.5, 40.2));
    api.on(
      'POST /service-areas/me',
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
        details: [
          {
            field: 'kind',
            code: 'LIMIT_REACHED',
            messageKey: 'error.validation.service_area.limit_reached',
          },
        ],
      }),
    );
    areas([]);
    await locate();
    await user().type(screen.getByRole('textbox', { name: en.areas.label }), 'One too many');
    await user().click(screen.getByRole('button', { name: en.areas.add }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.validation.service_area.limit_reached,
    );
  });

  it.each([
    [1, en.areas.denied],
    [2, en.areas.failed],
  ] as const)('says what to do when the device answers error %i', async (code, words) => {
    device(code);
    areas([]);
    await locate();
    expect(screen.getByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByRole('textbox', { name: en.areas.label })).toBeNull();
  });

  it('shows it is looking while the device has not answered', async () => {
    device(null);
    areas([]);
    await locate();
    const button = screen.getByRole('button', { name: en.areas.locating });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
