import { catalogs } from '@investigator/i18n';
import { colors } from '@investigator/ui-tokens';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnAgencyProfile, PublicAgencyProfile } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { brandingSection, deliveryUrl, ownAgencyProfile } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { AgencyProfileCard } from './agency-profile-card';
import { BrandingForm } from './branding-form';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './image-field';
import { ProfileEditor } from './profile-editor';
import { isDirty, projection, savedText } from './projection';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.agency;
const PROFILE = '/agencies/current/profile';
const STORAGE = 'https://storage.test/upload';
const user = () => userEvent.setup();

/** A file of this type and size; its bytes are never read. */
const file = (name: string, type = 'image/png', size = 1_000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

/** Storage beside the API stand-in: an upload goes straight to it, never through the API. */
const storage = { status: 200, fail: false };
const install = () => {
  api.install();
  storage.status = 200;
  storage.fail = false;
  const toApi = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (!String(input).startsWith(STORAGE)) return toApi(input, init);
      if (storage.fail) throw new TypeError('Failed to fetch');
      return new Response(null, { status: storage.status });
    }),
  );
};

beforeEach(() => {
  install();
  router.reset();
});

/** The fields `GET /agencies/:id/profile` answers with (agency-profile.service.ts), in its order. */
const PUBLIC_FIELDS = ['id', 'name', 'headline', 'about', 'countryCode', 'logo', 'cover'];

describe('the preview’s projection', () => {
  const own = ownAgencyProfile({
    displayName: 'Ararat Checks',
    about: 'Twelve years.',
    logo: { mediaId: 'logo-1', link: deliveryUrl('logo') },
    // Still being checked: customers would not see it, so neither does the preview.
    cover: { mediaId: 'cover-1', link: null },
  });

  it('is the public projection field for field — nothing the members see that customers do not', () => {
    const p = projection(own, savedText(own), 'Ararat Investigations LLC');
    expect(Object.keys(p)).toEqual(PUBLIC_FIELDS);
    expect(p).toEqual({
      id: own.id,
      name: 'Ararat Checks',
      headline: 'Due diligence across the Caucasus',
      about: 'Twelve years.',
      countryCode: 'AM',
      logo: deliveryUrl('logo'),
      cover: null,
    });
  });

  it('takes the text as typed, trimmed as the API stores it, and the registered name when none is set', () => {
    const p = projection(
      own,
      { displayName: '   ', headline: '  Company checks ', about: ' ' },
      'Ararat Investigations LLC',
    );
    expect(p).toMatchObject({
      name: 'Ararat Investigations LLC',
      headline: 'Company checks',
      about: null,
    });
    expect(projection(own, { displayName: '', headline: '', about: '' }, 'X').headline).toBe('');
    expect(projection(ownAgencyProfile(), savedText(ownAgencyProfile()), 'X')).toMatchObject({
      logo: null,
      cover: null,
    });
  });

  it('knows when the form holds what is not saved', () => {
    expect(isDirty(own, savedText(own))).toBe(false);
    expect(isDirty(own, { ...savedText(own), displayName: ' Ararat Checks ' })).toBe(false);
    expect(isDirty(own, { ...savedText(own), displayName: 'Other' })).toBe(true);
    expect(isDirty(own, { ...savedText(own), headline: '' })).toBe(true);
    expect(isDirty(own, { ...savedText(own), about: 'More.' })).toBe(true);
  });
});

describe('an agency as customers see it', () => {
  const agency = (over: Partial<PublicAgencyProfile> = {}): PublicAgencyProfile => ({
    id: 'a',
    name: 'Ararat Checks',
    headline: 'Due diligence across the Caucasus',
    about: 'Twelve years.\nCompany checks.',
    countryCode: 'AM',
    logo: deliveryUrl('logo'),
    cover: deliveryUrl('cover'),
    ...over,
  });

  it('shows every field of the projection: name, headline, country in the reader’s language, about and images', () => {
    const { container } = renderIntl(<AgencyProfileCard profile={agency()} />, 'ru');
    expect(screen.getByRole('heading', { level: 3, name: 'Ararat Checks' })).toBeVisible();
    expect(screen.getByText('Due diligence across the Caucasus')).toBeVisible();
    expect(screen.getByText('Армения')).toBeVisible();
    expect(screen.getByText(/Twelve years\./)).toHaveClass('whitespace-pre-line');
    const images = [...container.querySelectorAll('img')];
    expect(images.map((i) => [i.getAttribute('src'), i.getAttribute('alt')])).toEqual([
      [deliveryUrl('cover').signedUrl, ''],
      [deliveryUrl('logo').signedUrl, ''],
    ]);
  });

  it('shows nothing for what is not there, and no heading where the page already has one', () => {
    const { container } = renderIntl(
      <AgencyProfileCard
        profile={agency({ headline: '', about: null, countryCode: null, logo: null, cover: null })}
        named={false}
      />,
    );
    expect(screen.getByRole('article', { name: 'Ararat Checks' })).toBeVisible();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelectorAll('img, p')).toHaveLength(0);
  });
});

describe('the public profile editor', () => {
  const editor = (over: Partial<OwnAgencyProfile> = {}) =>
    renderIntl(
      <ProfileEditor initial={ownAgencyProfile(over)} registeredName="Ararat Investigations LLC" />,
    );
  const headline = () => screen.getByRole('textbox', { name: en.profile.headline });
  const saveButton = () => screen.getByRole('button', { name: en.profile.save });
  const publishButton = () => screen.getByRole('button', { name: en.profile.publish });

  it('starts from what is saved, says it is a draft, and saves nothing until something changes', () => {
    editor({ about: 'Twelve years.' });
    expect(screen.getByText(en.profile.draft)).toBeVisible();
    expect(screen.getByRole('textbox', { name: en.profile.display_name })).toHaveValue('');
    expect(
      screen.getByText('Leave empty to use the registered name, Ararat Investigations LLC.'),
    ).toBeVisible();
    expect(headline()).toHaveValue('Due diligence across the Caucasus');
    expect(screen.getByRole('textbox', { name: en.profile.about })).toHaveValue('Twelve years.');
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole('link', { name: en.profile.open_public })).toBeNull();
  });

  it('previews what customers would see, with the text as typed, before anything is saved', async () => {
    editor();
    await user().clear(headline());
    await user().type(headline(), 'Company checks');
    await user().click(screen.getByRole('button', { name: en.profile.preview }));
    const preview = await screen.findByRole('dialog', { name: en.profile.preview_title });
    expect(preview).toHaveTextContent(en.profile.preview_body);
    const card = within(preview).getByRole('article');
    expect(within(card).getByRole('heading', { name: 'Ararat Investigations LLC' })).toBeVisible();
    expect(card).toHaveTextContent('Company checks');
    expect(card).toHaveTextContent('Armenia');
    expect(api.calls).toEqual([]);
    await user().click(within(preview).getByRole('button', { name: en.profile.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('saves the text trimmed, blanks as cleared, against the version read — then works from the new one', async () => {
    editor({ displayName: 'Old name', about: 'Old.' });
    api.on(
      `PATCH ${PROFILE}`,
      200,
      ownAgencyProfile({ displayName: 'Ararat Checks', name: 'Ararat Checks', version: 2 }),
    );
    const name = screen.getByRole('textbox', { name: en.profile.display_name });
    await user().clear(name);
    await user().type(name, '  Ararat Checks ');
    await user().clear(screen.getByRole('textbox', { name: en.profile.about }));
    await user().click(saveButton());
    expect(await screen.findByRole('status')).toHaveTextContent(en.profile.saved);
    expect(api.calls).toMatchObject([
      {
        method: 'PATCH',
        path: PROFILE,
        body: {
          version: 1,
          displayName: 'Ararat Checks',
          headline: 'Due diligence across the Caucasus',
          about: null,
        },
      },
    ]);
    expect(name).toHaveValue('Ararat Checks');
    expect(saveButton()).toBeDisabled();
    expect(router.refresh).toHaveBeenCalled();

    // The next write names the version the last one returned.
    api.on(`POST ${PROFILE}/publish`, 200, ownAgencyProfile({ version: 3 }));
    await user().click(publishButton());
    expect(api.calls.at(-1)).toMatchObject({ path: `${PROFILE}/publish`, body: { version: 2 } });
  });

  it('says beside each field what the API refused in it', async () => {
    editor();
    api.on(
      `PATCH ${PROFILE}`,
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
        details: [
          {
            field: 'displayName',
            code: 'LENGTH',
            messageKey: 'error.validation.agency_profile.display_name_length',
          },
          {
            field: 'headline',
            code: 'LENGTH',
            messageKey: 'error.validation.agency_profile.headline_length',
          },
          {
            field: 'about',
            code: 'LENGTH',
            messageKey: 'error.validation.agency_profile.about_length',
          },
        ],
      }),
    );
    await user().type(headline(), '!');
    await user().click(saveButton());
    const messages = catalogs.en.error.validation.agency_profile;
    expect(await screen.findByText(messages.display_name_length)).toBeVisible();
    expect(screen.getByText(messages.headline_length)).toBeVisible();
    expect(screen.getByText(messages.about_length)).toBeVisible();
    expect(screen.getByRole('textbox', { name: en.profile.about })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // Said once, beside the field — not again under the error's title.
    expect(screen.getAllByText(messages.headline_length)).toHaveLength(1);
  });

  it('says to reload when someone else saved first', async () => {
    editor();
    api.on(`PATCH ${PROFILE}`, 409, apiError('STATE_CONFLICT', 'error.common.state_conflict'));
    await user().type(headline(), '!');
    await user().click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.common.state_conflict,
    );
  });

  it('says what stands between the profile and publishing, and holds the button back', () => {
    editor({ headline: null, missing: ['agency_setup', 'headline'] });
    expect(screen.getByText(en.profile.missing)).toBeVisible();
    expect(
      screen.getByText(catalogs.en.error.validation.agency_profile.agency_setup),
    ).toBeVisible();
    expect(screen.getByText(catalogs.en.error.validation.agency_profile.headline)).toBeVisible();
    expect(publishButton()).toBeDisabled();
  });

  it('publishes only what is saved: with changes waiting, it says to save first', async () => {
    editor();
    await user().type(headline(), '!');
    expect(publishButton()).toBeDisabled();
    expect(publishButton()).toHaveAccessibleDescription(en.profile.unsaved);
  });

  it('publishes, then links to the public page — and unpublishes', async () => {
    editor();
    api.on(`POST ${PROFILE}/publish`, 200, ownAgencyProfile({ publishedAt: 'now', version: 2 }));
    await user().click(publishButton());
    expect(await screen.findByRole('status')).toHaveTextContent(en.profile.published_now);
    expect(screen.getByText(en.profile.published)).toBeVisible();
    expect(screen.getByRole('link', { name: en.profile.open_public })).toHaveAttribute(
      'href',
      `/agencies/${ownAgencyProfile().id}`,
    );
    expect(api.calls.at(-1)).toMatchObject({ body: { version: 1 } });

    api.on(`POST ${PROFILE}/unpublish`, 200, ownAgencyProfile({ publishedAt: null, version: 3 }));
    await user().click(screen.getByRole('button', { name: en.profile.unpublish }));
    expect(await screen.findByText(en.profile.unpublished_now)).toBeVisible();
    expect(api.calls.at(-1)).toMatchObject({ path: `${PROFILE}/unpublish`, body: { version: 2 } });
    expect(screen.getByText(en.profile.draft)).toBeVisible();
  });

  it('lets a published profile be unpublished even with changes waiting, and says why publishing failed', async () => {
    editor({ publishedAt: 'then' });
    await user().type(headline(), '!');
    const unpublish = screen.getByRole('button', { name: en.profile.unpublish });
    expect(unpublish).toBeEnabled();
    expect(screen.queryByText(en.profile.unsaved)).toBeNull();
    api.on(`POST ${PROFILE}/unpublish`, 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    await user().click(unpublish);
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.auth.forbidden);
  });
});

describe('the logo and cover', () => {
  const editor = (over: Partial<OwnAgencyProfile> = {}) =>
    renderIntl(<ProfileEditor initial={ownAgencyProfile(over)} registeredName="Ararat" />);
  const group = (name: string) => screen.getByRole('group', { name });
  const choose = (name: string, f: File) =>
    userEvent
      .setup({ applyAccept: false })
      .upload(group(name).querySelector<HTMLInputElement>('input[type=file]')!, f);
  const authorise = (assetId: string) => {
    api.on('POST /media/uploads', 201, {
      assetId,
      upload: { url: STORAGE, fields: { signature: 'sig' } },
    });
    api.on(`POST /media/uploads/${assetId}/complete`, 200, { id: assetId });
  };

  it('says what each takes, in the reader’s units', () => {
    editor();
    expect(group(en.images.logo)).toHaveTextContent('JPEG, PNG or WebP, up to 2 MB.');
    expect(group(en.images.cover)).toHaveTextContent(
      'Shown across the top of the profile. JPEG, PNG or WebP, up to 5 MB.',
    );
    expect(IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_IMAGE_BYTES).toEqual({ logo: 2 * 1024 * 1024, cover: 5 * 1024 * 1024 });
  });

  it('uploads a logo privately, then names it on the profile — and waits for its safety check', async () => {
    editor();
    authorise('logo-9');
    api.on(
      `PATCH ${PROFILE}`,
      200,
      ownAgencyProfile({ version: 2, logo: { mediaId: 'logo-9', link: null } }),
    );
    await choose(en.images.logo, file('logo.png'));
    expect(await within(group(en.images.logo)).findByText(en.images.checking)).toBeVisible();
    expect(api.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/media/uploads', { category: 'AGENCY_LOGO', mimeType: 'image/png', bytes: 1_000 }],
      ['POST', '/media/uploads/logo-9/complete', undefined],
      ['PATCH', PROFILE, { version: 1, logoMediaId: 'logo-9' }],
    ]);
    expect(screen.getByRole('button', { name: `${en.images.replace} ${en.images.logo}` }));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows a checked image, replaces a cover and removes one', async () => {
    const { container } = editor({
      cover: { mediaId: 'cover-1', link: deliveryUrl('cover') },
      logo: { mediaId: 'logo-1', link: deliveryUrl('logo') },
    });
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      deliveryUrl('logo').signedUrl,
      deliveryUrl('cover').signedUrl,
    ]);
    authorise('cover-2');
    api.on(
      `PATCH ${PROFILE}`,
      200,
      ownAgencyProfile({ version: 2, cover: { mediaId: 'cover-2', link: deliveryUrl('c2') } }),
    );
    await choose(en.images.cover, file('cover.webp', 'image/webp'));
    await within(group(en.images.cover))
      .findByRole('status', {}, { timeout: 100 })
      .catch(() => {});
    expect(api.calls.at(-1)).toMatchObject({ body: { version: 1, coverMediaId: 'cover-2' } });
    expect(api.calls[0]).toMatchObject({ body: { category: 'AGENCY_COVER' } });

    api.on(`PATCH ${PROFILE}`, 200, ownAgencyProfile({ version: 3, cover: null }));
    await user().click(
      screen.getByRole('button', { name: `${en.images.remove} ${en.images.cover}` }),
    );
    expect(await screen.findByRole('button', { name: `${en.images.upload} ${en.images.cover}` }));
    expect(api.calls.at(-1)).toMatchObject({ body: { version: 2, coverMediaId: null } });
  });

  it('refuses a file the API would refuse, before sending anything', async () => {
    editor();
    await choose(en.images.logo, file('logo.gif', 'image/gif'));
    expect(within(group(en.images.logo)).getByRole('alert')).toHaveTextContent(
      en.images.wrong_type,
    );
    await choose(en.images.logo, file('logo.png', 'image/png', MAX_IMAGE_BYTES.logo + 1));
    expect(within(group(en.images.logo)).getByRole('alert')).toHaveTextContent(
      'This image is larger than 2 MB.',
    );
    expect(api.calls).toEqual([]);
  });

  it('says why an upload failed — refused, or never reaching storage — and can be tried again', async () => {
    editor();
    api.on('POST /media/uploads', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    await choose(en.images.logo, file('logo.png'));
    expect(await within(group(en.images.logo)).findByRole('alert')).toHaveTextContent(
      catalogs.en.error.auth.forbidden,
    );
    authorise('logo-9');
    storage.fail = true;
    await choose(en.images.logo, file('logo.png'));
    expect(await within(group(en.images.logo)).findByRole('alert')).toHaveTextContent(
      catalogs.en.error.common.internal,
    );
    expect(screen.getByRole('button', { name: `${en.images.upload} ${en.images.logo}` }));
  });

  it('opens the file chooser from its button, and ignores a chooser closed without a file', async () => {
    editor();
    const input = group(en.images.logo).querySelector<HTMLInputElement>('input[type=file]')!;
    const click = vi.spyOn(input, 'click');
    await user().click(
      screen.getByRole('button', { name: `${en.images.upload} ${en.images.logo}` }),
    );
    expect(click).toHaveBeenCalled();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(api.calls).toEqual([]);
  });
});

describe('the agency’s colours', () => {
  // Agency colours are data, not styles; token values stand in for them (no raw colours, even in a
  // spec). Each is chosen for how the API would treat it.
  const { light } = colors;
  const ACCENT = light.primary;
  const HEADER = light.success;
  const WHITE = light['primary-contrast'];
  /** Pale: the API would put dark text on it. */
  const PALE = light['primary-subtle'];
  const DARK = light.text;
  /** White on white: the API refuses it as an accent. */
  const LOW = light['surface-raised'];
  const BRANDING = 'PATCH /agencies/current/settings/branding';
  const accent = () => screen.getByRole('textbox', { name: en.branding.accent });
  const header = () => screen.getByRole('textbox', { name: en.branding.report_header });
  const save = () => screen.getByRole('button', { name: en.branding.save });
  const sample = () => screen.getByRole('figure', { name: en.branding.sample });

  it('shows the defaults — the platform’s own — and needs nothing set', () => {
    renderIntl(<BrandingForm initial={brandingSection()} />);
    expect(accent()).toHaveValue('');
    expect(accent()).toHaveAccessibleDescription(
      `${en.branding.accent_hint} ${en.branding.platform}`,
    );
    expect(header()).toHaveAccessibleDescription(
      `${en.branding.report_header_hint} ${en.branding.platform}`,
    );
    expect(save()).toBeDisabled();
    // Drawn on a light surface in every theme, in the platform's own colours.
    const surface = sample().querySelector('[data-theme="light"]')!;
    expect(surface).toBeInTheDocument();
    expect(within(sample()).getByText(en.branding.sample_report)).toHaveClass('bg-primary');
    expect(within(sample()).getByText(en.branding.sample_accent)).toHaveClass('bg-primary');
  });

  it('shows a colour as it is typed, once it is one, on a light surface', async () => {
    renderIntl(<BrandingForm initial={brandingSection()} />);
    await user().type(accent(), ACCENT.slice(0, 5).toUpperCase());
    expect(screen.queryByText(ACCENT.slice(0, 5))).toBeNull();
    await user().type(accent(), ACCENT.slice(5).toUpperCase());
    const swatch = screen.getByText(ACCENT).closest('[data-theme="light"]')!;
    expect(swatch.querySelector('span')).toHaveStyle({ backgroundColor: ACCENT });
  });

  it('saves both colours against the version read, blank as the platform’s own, then draws them', async () => {
    renderIntl(
      <BrandingForm
        initial={brandingSection({
          version: 2,
          values: { accentColor: ACCENT, reportHeaderColor: null },
          derived: { accentText: WHITE, reportHeaderText: null },
        })}
      />,
    );
    expect(accent()).toHaveAccessibleDescription(`${en.branding.accent_hint} Now: ${ACCENT}.`);
    api.on(
      BRANDING,
      200,
      brandingSection({
        version: 3,
        values: { accentColor: null, reportHeaderColor: HEADER },
        derived: { accentText: null, reportHeaderText: WHITE },
      }),
    );
    await user().clear(accent());
    await user().type(header(), ` ${HEADER.toUpperCase()} `);
    await user().click(save());
    expect(await screen.findByRole('status')).toHaveTextContent(en.branding.saved);
    expect(api.calls).toMatchObject([
      {
        path: '/agencies/current/settings/branding',
        body: { version: 2, values: { accentColor: null, reportHeaderColor: HEADER } },
      },
    ]);
    expect(header()).toHaveValue(HEADER);
    expect(within(sample()).getByText(en.branding.sample_report)).toHaveStyle({
      backgroundColor: HEADER,
      color: WHITE,
    });
    expect(within(sample()).getByText(en.branding.sample_accent)).toHaveClass('bg-primary');
    expect(router.refresh).toHaveBeenCalled();
    await user().type(accent(), '#');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('puts a saved colour back to the platform’s own when its field is emptied', async () => {
    renderIntl(
      <BrandingForm
        initial={brandingSection({
          version: 4,
          values: { accentColor: null, reportHeaderColor: HEADER },
          derived: { accentText: null, reportHeaderText: WHITE },
        })}
      />,
    );
    api.on(BRANDING, 200, brandingSection({ version: 5 }));
    await user().clear(header());
    await user().click(save());
    expect(await screen.findByRole('status')).toHaveTextContent(en.branding.saved);
    expect(api.calls[0]!.body).toEqual({
      version: 4,
      values: { accentColor: null, reportHeaderColor: null },
    });
    expect(header()).toHaveValue('');
    expect(header()).toHaveAccessibleDescription(
      `${en.branding.report_header_hint} ${en.branding.platform}`,
    );
  });

  it('draws a saved accent with the text colour the API chose for it', () => {
    renderIntl(
      <BrandingForm
        initial={brandingSection({
          values: { accentColor: PALE, reportHeaderColor: null },
          derived: { accentText: DARK, reportHeaderText: null },
        })}
      />,
    );
    expect(within(sample()).getByText(en.branding.sample_accent)).toHaveStyle({
      backgroundColor: PALE,
      color: DARK,
    });
  });

  it('says beside the field why a colour was refused', async () => {
    renderIntl(<BrandingForm initial={brandingSection()} />);
    api.on(
      BRANDING,
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
        details: [
          {
            field: 'values.accentColor',
            code: 'LOW_CONTRAST',
            messageKey: 'error.validation.branding.low_contrast',
          },
        ],
      }),
    );
    await user().type(accent(), LOW);
    await user().click(save());
    const refused = catalogs.en.error.validation.branding.low_contrast;
    expect(await screen.findByText(refused)).toBeVisible();
    expect(screen.getAllByText(refused)).toHaveLength(1);
    expect(accent()).toHaveAttribute('aria-invalid', 'true');
  });
});
