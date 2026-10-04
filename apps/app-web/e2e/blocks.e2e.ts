import { type Browser, type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './support/test';
import { expectAccessible } from './support/accessibility';
import { journeyAddress, journeyTag } from './support/journey';
import { owner } from './support/database';
import { link, mark } from './support/mailbox';
import { text } from './support/text';

/**
 * Blocking (T-052), against the real API: a customer blocks an investigator from their profile and
 * finds them in Account, where unblocking undoes it; an investigator blocks a customer from a
 * mission card, and the customer's missions leave their browse. Serial, per viewport.
 *
 * Two things here are written as the owner, because no screen in this suite makes them: an
 * investigator staff have verified, and a mission a moderator has published. Everything the
 * flows change, they change through the app.
 */
test.describe.configure({ mode: 'serial' });

/** The investigator's legal name: verification's, never shown to a customer (T-181). */
const INVESTIGATOR_NAME = 'Vardan Blockfield';
/** What customers know them by, per journey: pseudonyms are unique across the platform. */
let pseudonym: string;
/** With an address in it, as a customer may paste: a word the card must wrap, not widen for (T-178). */
const MISSION_TITLE = 'Records check for https://registry.example.test/companies/0123456789abcdef';
let missionTitle: string;
/**
 * The mission's category, which the card shows by its slug (no label in any language): 60
 * characters with nowhere to break, as a long compound word in any locale would be (T-178).
 */
let categorySlug: string;

let customer: Page;
let investigator: Page;
let profileId: string;

async function signedIn(browser: Browser, info: TestInfo, who: string): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({
    // Each person from their own address, as two people would.
    extraHTTPHeaders: {
      'X-Forwarded-For': journeyAddress(info, 'blocks', who === 'customer' ? 0 : 1),
    },
    baseURL: use.baseURL!,
    viewport: use.viewport!,
    ...(use.isMobile !== undefined && { isMobile: use.isMobile }),
    ...(use.hasTouch !== undefined && { hasTouch: use.hasTouch }),
    ...(use.timezoneId !== undefined && { timezoneId: use.timezoneId }),
    ...(use.locale !== undefined && { locale: use.locale }),
  });
  const page = await context.newPage();
  const email = `blocks-${who}-${info.project.name}-${journeyTag()}@example.test`;
  const password = `a long ${who} password`;
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
  return page;
}

const userOf = async (page: Page): Promise<string> =>
  ((await (await page.request.get('/api/v1/me')).json()) as { id: string }).id;

test.beforeAll(async ({ browser }, info) => {
  // This journey's own, so a repeat running beside it lists another mission and person, not one
  // with the same name. Letters only in the pseudonym: digits there can read as a phone number.
  const tag = journeyTag();
  missionTitle = `${MISSION_TITLE} (${info.project.name} ${tag})`;
  pseudonym = `Quiet Harbour ${tag.replace(/\d/g, (d) => 'ghijklmnop'[Number(d)]!)}`;
  categorySlug = `blocksrecordsverification${tag}${info.project.name}`.padEnd(60, 'x');
  customer = await signedIn(browser, info, 'customer');
  investigator = await signedIn(browser, info, 'investigator');
  const [customerId, investigatorId] = await Promise.all([userOf(customer), userOf(investigator)]);

  const sql = owner();
  try {
    // What staff verification would have left: an investigator, published and working.
    await sql`UPDATE users SET display_name = ${INVESTIGATOR_NAME} WHERE id = ${investigatorId}`;
    await sql`DELETE FROM user_roles WHERE user_id = ${investigatorId}`;
    await sql`INSERT INTO user_roles (user_id, role) VALUES (${investigatorId}, 'INVESTIGATOR')`;
    const [profile] = await sql<{ id: string }[]>`
      INSERT INTO investigator_profiles (user_id, visibility, verification_status, verified_at,
                                         accepting_work, pseudonym)
      VALUES (${investigatorId}, 'PUBLISHED', 'VERIFIED', now(), true, ${pseudonym})
      RETURNING id`;
    profileId = profile!.id;
    // And what a moderator would have published: one of the customer's missions.
    const [node] = await sql<{ id: string }[]>`
      INSERT INTO taxonomy_nodes (slug) VALUES (${categorySlug})
      RETURNING id`;
    await sql`
      INSERT INTO missions (customer_id, title, description, status, version, taxonomy_node_id,
                            country_code, deadline, budget_min_minor, budget_max_minor, currency,
                            languages, purpose, subject_relationship, lawful_purpose_confirmed_at,
                            submitted_at, published_at)
      VALUES (${customerId}, ${missionTitle}, 'Confirm a supplier is registered where it says.',
              'QUOTED', 1, ${node!.id}, 'AM', now() + interval '30 days', 50000, 150000, 'AMD',
              ARRAY['en'], 'Due diligence before a contract.', 'BUSINESS_RELATIONSHIP', now(),
              now(), now())`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  await Promise.all([customer.context().close(), investigator.context().close()]);
});

test('a customer blocks an investigator from their profile, and unblocks them from Account', async () => {
  await customer.goto(`/missions/investigators/${profileId}`);
  // Known by the name they chose; the legal one is nowhere on the page (T-181).
  await expect(customer.getByRole('heading', { level: 1, name: pseudonym })).toBeVisible();
  await expect(customer.getByText(INVESTIGATOR_NAME)).toHaveCount(0);

  await customer.getByRole('button', { name: text('account.block.action.investigator') }).click();
  const dialog = customer.getByRole('alertdialog', {
    name: text('account.block.investigator.title'),
  });
  await expect(dialog).toContainText(text('account.block.investigator.body'));
  await expectAccessible(customer);
  await dialog.getByRole('button', { name: text('account.block.confirm') }).click();
  await expect(customer.getByRole('status')).toHaveText(text('account.block.blocked'));

  await customer.goto('/account#blocks');
  const section = customer.getByRole('region', { name: text('account.blocks.title') });
  await expect(section.getByRole('listitem')).toHaveCount(1);
  await expect(section).toContainText(pseudonym);
  await expect(section).not.toContainText(INVESTIGATOR_NAME);
  await expect(section).toContainText(text('account.blocks.source.profile'));
  await expectAccessible(customer);

  await section.getByRole('button', { name: text('account.blocks.unblock') }).click();
  await expect(section).toContainText(text('account.blocks.empty'));
});

test('an investigator blocks a customer from a mission card, and their missions leave the browse', async () => {
  await investigator.goto('/missions');
  const card = investigator.getByRole('article', { name: missionTitle });
  await expect(card).toBeVisible();
  // The card's menu never pushes the page sideways, whatever the category is called (T-178): a
  // category with nowhere to break is cut short inside the card, not given the width it asks for.
  expect(
    await investigator.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const category = card.getByText(categorySlug, { exact: true });
  const [inside, around] = await Promise.all([category.boundingBox(), card.boundingBox()]);
  expect(inside!.x + inside!.width).toBeLessThanOrEqual(around!.x + around!.width);
  if (test.info().project.name === 'mobile') {
    expect(await category.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  }

  await card.getByRole('button', { name: text('account.block.menu') }).click();
  await investigator.getByRole('menuitem', { name: text('account.block.action.customer') }).click();
  const dialog = investigator.getByRole('alertdialog', {
    name: text('account.block.customer.title'),
  });
  await expect(dialog).toContainText(text('account.block.customer.body'));
  await dialog.getByRole('button', { name: text('account.block.confirm') }).click();
  await expect(card).toHaveCount(0);

  await investigator.goto('/account#blocks');
  const section = investigator.getByRole('region', { name: text('account.blocks.title') });
  await expect(section).toContainText(text('account.blocks.customer'));
  await expect(section).toContainText(text('account.blocks.source.mission'));
  await expect(section.getByRole('link')).toHaveCount(0);

  // The customer is told nothing: nothing in their own list, and their mission as it was.
  const theirs = (await (await customer.request.get('/api/v1/blocks')).json()) as {
    items: unknown[];
  };
  expect(theirs.items).toEqual([]);
  const sql = owner();
  try {
    const [mission] = await sql<{ status: string }[]>`
      SELECT status FROM missions WHERE title = ${missionTitle}`;
    expect(mission?.status).toBe('QUOTED');
  } finally {
    await sql.end();
  }
});
