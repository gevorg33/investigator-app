import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './support/accessibility';
import { link, mark } from './support/mailbox';
import { text } from './support/text';

/**
 * An agency's profile and colours (T-094), against the real API: create the agency, write and
 * preview its profile, publish it, and see that the public page is what the preview showed; then
 * its colours — a refused one said beside its field, a saved one drawn on a light surface even in
 * dark mode. Serial, on one account per viewport.
 *
 * Logo and cover uploads are not driven here: they go to Cloudinary, which neither CI nor local
 * development has (ACTIONS-FOR-ME #4). Their flow is covered against a stand-in in Vitest.
 */
test.describe.configure({ mode: 'serial' });

const AGENCY = 'Ararat Checks';
const HEADLINE = 'Due diligence across the Caucasus';
let page: Page;
let email: string;
const password = 'a long agency password';

const heading = (name: string) => page.getByRole('heading', { level: 1, name });

test.beforeAll(async ({ browser }, info) => {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL!,
    viewport: use.viewport!,
    ...(use.isMobile !== undefined && { isMobile: use.isMobile }),
    ...(use.hasTouch !== undefined && { hasTouch: use.hasTouch }),
    ...(use.timezoneId !== undefined && { timezoneId: use.timezoneId }),
    ...(use.locale !== undefined && { locale: use.locale }),
  });
  page = await context.newPage();

  // A confirmed account, set up through the API as the screens would — the account screens are
  // account.e2e.ts's subject, not this one's.
  email = `agency-${info.project.name}-${Date.now()}@example.test`;
  const documents = (await (
    await page.request.get('/api/v1/legal/required?for=registration&locale=en')
  ).json()) as Array<{ id: string }>;
  const since = mark();
  const registered = await page.request.post('/api/v1/auth/register', {
    data: { email, password, acceptedDocumentIds: documents.map((d) => d.id), locale: 'en' },
  });
  expect(registered.ok()).toBe(true);
  const token = new URL(await link(since, email, 'email_verification')).searchParams.get('token');
  expect((await page.request.post('/api/v1/auth/verify-email', { data: { token } })).ok()).toBe(
    true,
  );
  await page.goto('/sign-in');
  await page.getByLabel(text('auth.email')).fill(email);
  await page.getByLabel(text('auth.password'), { exact: true }).fill(password);
  await page.getByRole('button', { name: text('auth.sign_in.submit') }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
});

test.afterAll(async () => {
  await page.context().close();
});

test('creates an agency and reaches its profile from Account', async () => {
  await page.goto('/agencies/new');
  await page.getByLabel(text('workspace.create_agency.name')).fill(AGENCY);
  await page.getByLabel(text('workspace.create_agency.country')).selectOption('AM');
  await page.getByLabel(text('workspace.create_agency.email')).fill('office@ararat.example.test');
  await page.getByLabel(text('workspace.create_agency.currency')).selectOption('AMD');
  await page.getByLabel(text('workspace.create_agency.accept')).check();
  await page.getByRole('button', { name: text('workspace.create_agency.submit') }).click();
  await expect(page).toHaveURL(/\/$/);

  // Home shows its owner what is left (T-149): the details are complete — the form asked for them
  // all — and the profile is not published yet.
  const checklist = page.getByRole('region', {
    name: text('home.checklist.title', { name: AGENCY }),
  });
  await expect(
    checklist.getByRole('link', { name: new RegExp(text('home.checklist.details')) }),
  ).toContainText(text('home.checklist.done'));
  await expect(
    checklist.getByRole('link', { name: new RegExp(text('home.checklist.profile')) }),
  ).toContainText(text('home.checklist.todo'));
  await expectAccessible(page);

  await page.goto('/account');
  await page.getByRole('link', { name: new RegExp(text('agency.link')) }).click();
  await expect(page).toHaveURL(/\/agency$/);
  await expect(heading(text('agency.title'))).toBeVisible();
  await expect(page.getByText(text('agency.profile.draft'))).toBeVisible();
  // Nothing configured, and nothing has to be: the colours are the platform's own.
  await expect(
    page.getByRole('textbox', { name: text('agency.branding.accent') }),
  ).toHaveAccessibleDescription(
    `${text('agency.branding.accent_hint')} ${text('agency.branding.platform')}`,
  );
  await expectAccessible(page);
});

test('previews unsaved text, and the public page is exactly what the preview showed', async () => {
  // A new agency has no headline, so it cannot be published yet — and says so.
  await expect(page.getByText(text('error.validation.agency_profile.headline'))).toBeVisible();
  await expect(page.getByRole('button', { name: text('agency.profile.publish') })).toBeDisabled();

  await page.getByRole('textbox', { name: text('agency.profile.headline') }).fill(HEADLINE);
  await page
    .getByRole('textbox', { name: text('agency.profile.about') })
    .fill('Twelve years of company checks.');
  await page.getByRole('button', { name: text('agency.profile.preview') }).click();
  const preview = page.getByRole('dialog', { name: text('agency.profile.preview_title') });
  const previewed = preview.getByRole('article');
  await expect(previewed).toContainText(HEADLINE);
  await expect(previewed).toContainText('Armenia');
  const shown = await previewed.innerText();
  await expectAccessible(page);
  await preview.getByRole('button', { name: text('agency.profile.close') }).click();

  await page.getByRole('button', { name: text('agency.profile.save') }).click();
  await expect(page.getByRole('status')).toHaveText(text('agency.profile.saved'));
  await page.getByRole('button', { name: text('agency.profile.publish') }).click();
  await expect(page.getByRole('status')).toHaveText(text('agency.profile.published_now'));

  await page.getByRole('link', { name: text('agency.profile.open_public') }).click();
  await expect(page).toHaveURL(/\/agencies\/[0-9a-f-]{36}$/);
  await expect(heading(AGENCY)).toBeVisible();
  const card = page.getByRole('article', { name: AGENCY });
  // The public page leaves out the name its heading already says; everything else is the same,
  // line for line and in the same order.
  const lines = (s: string) => s.split('\n').filter((l) => l.trim() !== '');
  expect(lines(await card.innerText())).toEqual(lines(shown).filter((l) => l !== AGENCY));
  await expectAccessible(page);
});

test('ticks the published profile on Home, and hides the list for every device once dismissed', async ({
  browser,
}, info) => {
  await page.goto('/');
  const checklist = page.getByRole('region', {
    name: text('home.checklist.title', { name: AGENCY }),
  });
  await expect(checklist).toContainText(text('home.checklist.complete'));
  await checklist.getByRole('button', { name: text('home.checklist.dismiss') }).click();
  await expect(checklist).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: text('nav.home') })).toBeVisible();
  await expect(checklist).toHaveCount(0);

  // Another device: a fresh browser, the same account, the same agency — still hidden.
  const other = await browser.newContext({
    baseURL: info.project.use.baseURL!,
    viewport: info.project.use.viewport!,
  });
  try {
    const second = await other.newPage();
    await second.goto('/sign-in');
    await second.getByLabel(text('auth.email')).fill(email);
    await second.getByLabel(text('auth.password'), { exact: true }).fill(password);
    await second.getByRole('button', { name: text('auth.sign_in.submit') }).click();
    await expect(second).not.toHaveURL(/\/sign-in/);
    // Sessions open in the Personal workspace; the agency is chosen, as a person would.
    const agencyId = (await (await second.request.get('/api/v1/workspaces')).json()).find(
      (w: { kind: string }) => w.kind === 'AGENCY',
    ).id as string;
    expect((await second.request.post(`/api/v1/workspaces/${agencyId}/activate`)).ok()).toBe(true);
    await second.goto('/');
    await expect(second.getByRole('heading', { level: 1, name: text('nav.home') })).toBeVisible();
    await expect(
      second.getByRole('region', { name: text('home.checklist.title', { name: AGENCY }) }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('refuses an unreadable colour beside its field, and draws a saved one on a light surface', async () => {
  await page.goto('/agency');
  const accent = page.getByRole('textbox', { name: text('agency.branding.accent') });
  const save = page.getByRole('button', { name: text('agency.branding.save') });

  await accent.fill('#ffff00');
  await save.click();
  await expect(page.getByText(text('error.validation.branding.low_contrast'))).toBeVisible();
  await expect(accent).toHaveAttribute('aria-invalid', 'true');

  await accent.fill('#1D4ED8');
  await save.click();
  await expect(page.getByText(text('agency.branding.saved'))).toBeVisible();
  await expect(accent).toHaveValue('#1d4ed8');

  const sample = page.getByRole('figure', { name: text('agency.branding.sample') });
  const fill = sample.getByText(text('agency.branding.sample_accent'));
  await expect(fill).toHaveCSS('background-color', 'rgb(29, 78, 216)');
  await expect(fill).toHaveCSS('color', 'rgb(255, 255, 255)');

  // Dark mode changes the app around it, not the surface a branded fill is drawn on. Reduced
  // motion makes the switch instant (every duration token is 0), so nothing is measured mid-fade.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const surface = sample.locator('[data-theme="light"]');
  await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('body')).not.toHaveCSS('background-color', 'rgb(247, 247, 248)');
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: null });
});
