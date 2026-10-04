import { type Page } from '@playwright/test';
import { expect, test } from './support/test';
import { expectAccessible } from './support/accessibility';
import { journeyAddress, journeyTag } from './support/journey';
import { link, mark } from './support/mailbox';
import { text } from './support/text';

/**
 * A customer's mission pages refresh after a change, in the production build (T-186): an edited
 * draft's new title on Missions, a cancelled draft listed as cancelled, and a draft changed somewhere
 * else shown as it now stands when cancelling it is refused — none of it needing a reload.
 *
 * Next 15's router can leave a `router.refresh()` uncommitted when a `loading.tsx` sits above the
 * page (vercel/next.js#86151, fixed in 16.3), and a streamed page can leave its hidden copy behind
 * (`<div hidden id="S:0">`). Every page here is checked for both. Serial, on one account per viewport.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;

const heading = (name: string) => page.getByRole('heading', { level: 1, name });

/** Nothing streamed is left behind once the page is interactive: one copy of everything. */
const oneCopy = async () => {
  await page.waitForLoadState('load');
  await expect(page.locator('[hidden][id^="S:"]')).toHaveCount(0);
  await expect(page.locator('main')).toHaveCount(1);
};

/** A draft, as the intake's first save would leave it. */
const draft = async (title: string) => {
  const created = await page.request.post('/api/v1/missions/me', { data: { title } });
  expect(created.ok()).toBe(true);
  return (await created.json()) as { id: string; version: number };
};

test.beforeAll(async ({ browser }, info) => {
  const use = info.project.use;
  const context = await browser.newContext({
    extraHTTPHeaders: { 'X-Forwarded-For': journeyAddress(info, 'missions') },
    baseURL: use.baseURL!,
    viewport: use.viewport!,
    ...(use.isMobile !== undefined && { isMobile: use.isMobile }),
    ...(use.hasTouch !== undefined && { hasTouch: use.hasTouch }),
    ...(use.timezoneId !== undefined && { timezoneId: use.timezoneId }),
    ...(use.locale !== undefined && { locale: use.locale }),
  });
  page = await context.newPage();

  // A confirmed customer, set up through the API as the screens would — the account screens are
  // account.e2e.ts's subject, not this one's.
  const email = `missions-${info.project.name}-${journeyTag()}@example.test`;
  const password = 'a long missions password';
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
  const required = await page.request.get('/api/v1/legal/required?for=CUSTOMER&locale=en');
  const accepted =
    required.status() === 204
      ? []
      : ((await required.json()) as Array<{ id: string }>).map((d) => d.id);
  const role = await page.request.post('/api/v1/profiles/roles', {
    data: { role: 'CUSTOMER', acceptedDocumentIds: accepted },
  });
  expect(role.ok()).toBe(true);
});

test.afterAll(async () => {
  await page.context().close();
});

test('an edited draft shows its new title on Missions at once', async () => {
  await draft('Supplier check');
  await page.goto('/missions');
  await oneCopy();
  await page.getByRole('link', { name: /Supplier check/ }).click();
  await expect(heading('Supplier check')).toBeVisible();
  await oneCopy();

  await page.getByLabel(text('missions.intake.need.title')).fill('Supplier check in Yerevan');
  await page.getByRole('button', { name: text('missions.intake.later') }).click();
  await expect(page).toHaveURL(/\/missions$/);
  await expect(page.getByRole('link', { name: /Supplier check in Yerevan/ })).toBeVisible();
  await oneCopy();
  await expectAccessible(page);
});

test('a cancelled draft is listed as cancelled without a reload', async () => {
  await page.getByRole('link', { name: /Supplier check in Yerevan/ }).click();
  await expect(heading('Supplier check in Yerevan')).toBeVisible();
  await page.getByRole('button', { name: text('missions.cancel.action') }).click();
  await page
    .getByRole('alertdialog', { name: text('missions.cancel.draft.title') })
    .getByRole('button', { name: text('missions.cancel.confirm') })
    .click();
  await expect(page).toHaveURL(/\/missions$/);
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Supplier check in Yerevan' }),
  ).toContainText(text('missions.status.CANCELLED'));
  await oneCopy();
});

test('a draft changed elsewhere is shown as it stands when cancelling it is refused', async () => {
  const mission = await draft('Registry lookup');
  await page.goto(`/missions/${mission.id}`);
  await expect(heading('Registry lookup')).toBeVisible();
  await oneCopy();

  // Another tab renames it: the page still holds the version it was rendered with.
  const renamed = await page.request.patch(`/api/v1/missions/me/${mission.id}`, {
    data: { title: 'Registry lookup, renamed', version: mission.version },
  });
  expect(renamed.ok()).toBe(true);

  await page.getByRole('button', { name: text('missions.cancel.action') }).click();
  await page
    .getByRole('alertdialog', { name: text('missions.cancel.draft.title') })
    .getByRole('button', { name: text('missions.cancel.confirm') })
    .click();
  await expect(page.getByText(text('missions.cancel.conflict'))).toBeVisible();
  // Refreshed in place: the heading is the title as it now stands.
  await expect(heading('Registry lookup, renamed')).toBeVisible();
  await oneCopy();
  await expectAccessible(page);
});
