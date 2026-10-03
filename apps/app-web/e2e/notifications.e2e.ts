import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { expectAccessible } from './support/accessibility';
import { journeyAddress, journeyTag } from './support/journey';
import { owner } from './support/database';
import { link, mark } from './support/mailbox';
import { text } from './support/text';

/**
 * The notification centre and email settings (T-169), against the real API: the bell's count, the
 * centre as a popover on a desktop and a sheet on a phone, paging, opening one, marking all read,
 * and turning activity emails off from Account. Serial, per viewport.
 *
 * The notifications themselves are written as the owner: they come from the outbox worker, which
 * this suite does not run (T-036 covers that path end to end). Everything the flow changes, it
 * changes through the app.
 */
test.describe.configure({ mode: 'serial' });

/** One more than a page (`GET /notifications` returns 20), so "Show more" has something to show. */
const UNREAD = 21;

let page: Page;
let userId: string;
let missionId: string;

async function signedIn(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({
    extraHTTPHeaders: { 'X-Forwarded-For': journeyAddress(info, 'notifications') },
    baseURL: use.baseURL!,
    viewport: use.viewport!,
    ...(use.isMobile !== undefined && { isMobile: use.isMobile }),
    ...(use.hasTouch !== undefined && { hasTouch: use.hasTouch }),
    ...(use.timezoneId !== undefined && { timezoneId: use.timezoneId }),
    ...(use.locale !== undefined && { locale: use.locale }),
  });
  const p = await context.newPage();
  const email = `notifications-${info.project.name}-${journeyTag()}@example.test`;
  const password = 'a long notifications password';
  const documents = (await (
    await p.request.get('/api/v1/legal/required?for=registration&locale=en')
  ).json()) as Array<{ id: string }>;
  const since = mark();
  const registered = await p.request.post('/api/v1/auth/register', {
    data: { email, password, acceptedDocumentIds: documents.map((d) => d.id), locale: 'en' },
  });
  expect(registered.ok()).toBe(true);
  const token = new URL(await link(since, email, 'email_verification')).searchParams.get('token');
  expect((await p.request.post('/api/v1/auth/verify-email', { data: { token } })).ok()).toBe(true);
  await p.goto('/sign-in');
  await p.getByLabel(text('auth.email')).fill(email);
  await p.getByLabel(text('auth.password'), { exact: true }).fill(password);
  await p.getByRole('button', { name: text('auth.sign_in.submit') }).click();
  await expect(p).not.toHaveURL(/\/sign-in/);
  return p;
}

const bell = (count: number) =>
  page.getByRole('button', {
    name: count === 0 ? text('notifications.title') : `Notifications, ${count} unread`,
  });

/** The centre, however this viewport frames it: both are dialogs named by the title. */
const centre = () => page.getByRole('dialog', { name: text('notifications.title') });

async function noSideScroll() {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(client);
}

test.beforeAll(async ({ browser }, info) => {
  page = await signedIn(browser, info);
  userId = ((await (await page.request.get('/api/v1/me')).json()) as { id: string }).id;
  const workspaces = (await (await page.request.get('/api/v1/workspaces')).json()) as Array<{
    id: string;
    current: boolean;
  }>;
  const workspaceId = workspaces.find((w) => w.current)!.id;

  const sql = owner();
  try {
    // A customer, as whoever receives these is: a mission's page opens only for its customer.
    await sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}, 'CUSTOMER')
              ON CONFLICT DO NOTHING`;
    // A mission of theirs for the notifications to lead to, sent and under review — not published,
    // so no other spec's browse lists it: every investigator there sees every published mission.
    const [node] = await sql<{ id: string }[]>`
      INSERT INTO taxonomy_nodes (slug) VALUES (${`notifications-${journeyTag()}-${info.project.name}`})
      RETURNING id`;
    const [mission] = await sql<{ id: string }[]>`
      INSERT INTO missions (customer_id, customer_tenant_id, title, description, status, version, taxonomy_node_id,
                            country_code, deadline, budget_min_minor, budget_max_minor, currency,
                            languages, purpose, subject_relationship, lawful_purpose_confirmed_at,
                            submitted_at)
      VALUES (${userId}, ${workspaceId}, 'Where a supplier is registered',
              'Confirm a supplier is registered where it says.', 'UNDER_REVIEW', 1, ${node!.id}, 'AM',
              now() + interval '30 days', 50000, 150000, 'AMD', ARRAY['en'],
              'Due diligence before a contract.', 'BUSINESS_RELATIONSHIP', now(), now())
      RETURNING id`;
    missionId = mission!.id;
    // What the worker would have written: one read long ago, then one a minute for the rest —
    // the newest a report, so the first row is known.
    for (let i = 0; i <= UNREAD; i++) {
      const read = i === 0;
      const kind = i === UNREAD ? 'assignment_report_ready' : 'mission_published';
      await sql`
        INSERT INTO notifications (tenant_id, recipient_id, event_id, kind, subject_type, subject_id,
                                   href, created_at, read_at)
        VALUES (${workspaceId}, ${userId}, gen_random_uuid(), ${kind}, 'mission', ${missionId},
                ${`/missions/${missionId}`},
                now() - make_interval(mins => ${(UNREAD - i) * 60 + 1}),
                ${read ? sql`now()` : null})`;
    }
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  await page.context().close();
});

test('the bell counts what is unread, and the centre lists it a page at a time', async () => {
  await page.goto('/');
  await expect(bell(UNREAD)).toBeVisible();
  await noSideScroll();
  await expectAccessible(page);

  await bell(UNREAD).click();
  const c = centre();
  await expect(c.getByRole('link')).toHaveCount(20);
  const first = c.getByRole('link').first();
  await expect(first).toHaveAttribute('href', `/missions/${missionId}`);
  await expect(first).toContainText(text('notifications.kind.assignment_report_ready'));
  await expect(first).toContainText(text('notifications.unread'));
  await noSideScroll();
  await expectAccessible(page);
  await page.screenshot({ path: test.info().outputPath('centre.png') });

  await c.getByRole('button', { name: text('notifications.more') }).click();
  await expect(c.getByRole('link')).toHaveCount(UNREAD + 1);
  await expect(c.getByRole('button', { name: text('notifications.more') })).toHaveCount(0);
  // The oldest was read before: it says nothing about being unread.
  await expect(c.getByRole('link').last()).not.toContainText(text('notifications.unread'));
});

test('opening one goes to it, closes the centre, and lowers the count', async () => {
  await centre().getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/missions/${missionId}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Where a supplier is registered' }),
  ).toBeVisible();
  await expect(centre()).toHaveCount(0);
  await expect(bell(UNREAD - 1)).toBeVisible();
  // And the API agrees, after a reload.
  await page.reload();
  await expect(bell(UNREAD - 1)).toBeVisible();
});

test('marking all read clears the count', async () => {
  await bell(UNREAD - 1).click();
  await centre()
    .getByRole('button', { name: text('notifications.mark_all') })
    .click();
  await expect(centre()).not.toContainText(text('notifications.unread'));
  await expect(centre().getByRole('button', { name: text('notifications.mark_all') })).toHaveCount(
    0,
  );
  // On a phone the sheet is modal, and the bell behind it hidden until it closes.
  await page.keyboard.press('Escape');
  await expect(centre()).toHaveCount(0);
  await expect(bell(0)).toBeVisible();
  await page.reload();
  await expect(bell(0)).toBeVisible();
});

test('activity emails are turned off from Account, and stay off', async () => {
  await page.goto('/account#emails');
  const section = page.getByRole('region', { name: text('account.emails.title') });
  const toggle = section.getByRole('switch', { name: text('account.emails.activity') });
  await expect(toggle).toBeChecked();
  await expectAccessible(page);
  // The row is the target, not only the small switch.
  await section.getByText(text('account.emails.activity'), { exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: text('account.emails.title') })
      .getByRole('switch', { name: text('account.emails.activity') }),
  ).not.toBeChecked();

  const sql = owner();
  try {
    const rows = await sql<{ enabled: boolean }[]>`
      SELECT enabled FROM notification_preferences
      WHERE user_id = ${userId} AND category = 'activity' AND channel = 'email'`;
    expect(rows).toEqual([{ enabled: false }]);
  } finally {
    await sql.end();
  }
});
