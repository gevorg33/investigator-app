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
  // Published, but nobody invited yet (T-093): the list is not done until someone is on the way.
  const invite = checklist.getByRole('link', { name: new RegExp(text('home.checklist.invite')) });
  await expect(invite).toContainText(text('home.checklist.todo'));
  await expect(invite).toHaveAttribute('href', '/agency/people#invitations');
  const invited = await page.request.post('/api/v1/agencies/current/invitations', {
    data: { email: `colleague-${info.project.name}-${Date.now()}@example.test`, role: 'VIEWER' },
  });
  expect(invited.ok()).toBe(true);
  await page.reload();
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

// ── The agency console (T-093): people, teams and investigator profiles, on the same account ──────

test('invites someone, sends it again, and cancels it only once asked by address', async () => {
  await page.goto('/account');
  await page.getByRole('link', { name: new RegExp(`^${text('agency.people.link')}`) }).click();
  await expect(page).toHaveURL(/\/agency\/people$/);
  await expect(heading(text('agency.people.title'))).toBeVisible();
  // The owner is the agency's one member so far, and is told it is them.
  const members = page.getByRole('region', { name: text('agency.people.members_title') });
  // A card list on a phone, a table from `lg`: one of the two is shown at each width.
  await expect(members.getByText(email).filter({ visible: true })).toBeVisible();
  await expect(
    members.getByText(text('agency.console.you')).filter({ visible: true }),
  ).toBeVisible();
  await expectAccessible(page);

  const invitee = `invitee-${Date.now()}@example.test`;
  await page.getByRole('textbox', { name: text('agency.invitations.email') }).fill(invitee);
  await page
    .getByRole('combobox', { name: text('agency.invitations.role') })
    .selectOption('VIEWER');
  await page.getByRole('button', { name: text('agency.invitations.send') }).click();
  await expect(page.getByRole('status')).toHaveText(
    text('agency.invitations.sent', { email: invitee }),
  );
  const row = page.getByRole('listitem').filter({ hasText: invitee });
  await expect(row).toContainText(text('agency.invitations.status_PENDING'));
  await expect(row).toContainText(text('agency.roles.VIEWER'));

  await row
    .getByRole('button', { name: text('agency.invitations.resend_label', { email: invitee }) })
    .click();
  await expect(row.getByRole('status')).toHaveText(
    text('agency.invitations.resent', { email: invitee }),
  );

  await row
    .getByRole('button', { name: text('agency.invitations.cancel_label', { email: invitee }) })
    .click();
  const sheet = page.getByRole('dialog', {
    name: text('agency.invitations.cancel_title', { email: invitee }),
  });
  await expect(sheet).toContainText(text('agency.invitations.cancel_body', { email: invitee }));
  await expectAccessible(page);
  await sheet.getByRole('button', { name: text('agency.invitations.cancel_confirm') }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toHaveCount(0);
});

test('makes a team, puts the owner in and takes them out, renames it, and deletes it once asked', async () => {
  await page
    .getByRole('navigation', { name: text('agency.nav.label') })
    .getByRole('link', { name: text('agency.nav.teams') })
    .click();
  await expect(heading(text('agency.teams.title'))).toBeVisible();
  await expect(page.getByText(text('agency.teams.empty_title'))).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('textbox', { name: text('agency.teams.name') }).fill('Yerevan office');
  await page.getByRole('button', { name: text('agency.teams.create') }).click();
  const team = page.getByRole('heading', { name: 'Yerevan office' });
  await expect(team).toBeVisible();

  await page
    .getByRole('combobox', { name: text('agency.teams.add_label') })
    .selectOption({ label: email });
  await page.getByRole('button', { name: text('agency.teams.add') }).click();
  const out = page.getByRole('button', {
    name: text('agency.teams.remove_member', { name: email, team: 'Yerevan office' }),
  });
  await expect(out).toBeVisible();
  await expect(page.getByText(text('agency.teams.everyone_in'))).toBeVisible();
  await out.click();
  await expect(out).toHaveCount(0);

  await page
    .getByRole('button', { name: text('agency.teams.edit_label', { team: 'Yerevan office' }) })
    .click();
  const name = page.getByRole('textbox', { name: text('agency.teams.name') }).last();
  await expect(name).toBeFocused();
  await name.fill('Gyumri office');
  await page.getByRole('button', { name: text('agency.teams.save') }).click();
  const edit = page.getByRole('button', {
    name: text('agency.teams.edit_label', { team: 'Gyumri office' }),
  });
  await expect(edit).toBeFocused();

  await page
    .getByRole('button', { name: text('agency.teams.delete_label', { team: 'Gyumri office' }) })
    .click();
  const sheet = page.getByRole('dialog', {
    name: text('agency.teams.delete_title', { team: 'Gyumri office' }),
  });
  await expectAccessible(page);
  await sheet
    .getByRole('button', { name: text('agency.teams.delete_confirm', { team: 'Gyumri office' }) })
    .click();
  await expect(page.getByText(text('agency.teams.empty_title'))).toBeVisible();
});

test('makes an investigator profile for a member, and each save shows on the page at once', async () => {
  // The owner takes up the investigator role themself, in their Personal workspace (T-087) — an
  // agency cannot do it for them.
  const workspaces = (await (await page.request.get('/api/v1/workspaces')).json()) as Array<{
    id: string;
    kind: string;
  }>;
  const personal = workspaces.find((w) => w.kind === 'PERSONAL')!.id;
  const required = (await (
    await page.request.get('/api/v1/legal/required?for=INVESTIGATOR&locale=en')
  ).json()) as Array<{ id: string }>;
  const role = await page.request.post('/api/v1/profiles/roles', {
    headers: { 'x-workspace': personal },
    data: { role: 'INVESTIGATOR', acceptedDocumentIds: required.map((d) => d.id) },
  });
  expect(role.ok()).toBe(true);

  await page.goto('/agency/investigators');
  await expect(heading(text('agency.investigators.title'))).toBeVisible();
  await expect(page.getByText(text('agency.investigators.empty_title'))).toBeVisible();
  await page
    .getByRole('combobox', { name: text('agency.investigators.member') })
    .selectOption({ label: email });
  await page.getByRole('button', { name: text('agency.investigators.make') }).click();
  await expect(page).toHaveURL(/\/agency\/investigators\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText(text('agency.investigators.held_by', { person: email })),
  ).toBeVisible();
  await expect(page.getByText(text('investigator.status.agency_body'))).toBeVisible();
  // The holder's legal name and their choice of name are theirs, not the agency's.
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
  await expectAccessible(page);

  // Letters only: six digits in a pseudonym read as a phone number and are refused.
  const pseudonym = `Ararat Desk ${Date.now()
    .toString(36)
    .replace(/\d/g, (d) => 'ghijklmnop'[Number(d)]!)}`;
  await page
    .getByRole('textbox', { name: text('investigator.details.agency_pseudonym') })
    .fill(pseudonym);
  await page.getByRole('button', { name: text('investigator.details.save'), exact: true }).click();
  await expect(page.getByText(text('investigator.details.saved'))).toBeVisible();
  // The page shows the save without a reload: the heading is the name customers will see.
  await expect(heading(pseudonym)).toBeVisible();

  await page.getByRole('switch', { name: text('investigator.status.agency_publish') }).click();
  await expect(
    page.getByRole('switch', { name: text('investigator.status.agency_publish') }),
  ).toBeChecked();
  await page.getByRole('link', { name: text('agency.investigators.back') }).click();
  await expect(
    page.getByRole('link', { name: text('agency.investigators.edit_label', { name: pseudonym }) }),
  ).toBeVisible();
  await expect(
    page.getByText(text('agency.investigators.shown')).filter({ visible: true }),
  ).toBeVisible();
  await expectAccessible(page);
});
