import { localeName } from '@investigator/i18n';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { expectAccessible } from './support/accessibility';
import { owner } from './support/database';
import { link, mark } from './support/mailbox';
import { PUBLISHED } from './support/stack';
import { text } from './support/text';

/**
 * One reader's first hour, in order, against the real API (T-139): the flows every other screen
 * depends on. Serial, on one account per viewport — each step starts where the last one left the
 * account, as it would for a person, and a failure stops the steps that could only fail after it.
 */
test.describe.configure({ mode: 'serial' });

const SESSION_COOKIE = 'investigator_session';
const REGISTRATION = PUBLISHED.filter(
  (d) => d.type === 'PRIVACY_POLICY' || d.type === 'TERMS_OF_SERVICE',
);
const CUSTOMER_TERMS = PUBLISHED.find((d) => d.type === 'TERMS_AND_CONDITIONS')!;

let email: string;
let password = 'a long first password';
let context: BrowserContext;
let page: Page;

/** A browser of the same shape as this project's — a second device, or the same one wiped. */
function freshContext(browser: Browser): Promise<BrowserContext> {
  const use = test.info().project.use;
  const options: BrowserContextOptions = {};
  for (const key of [
    'baseURL',
    'viewport',
    'isMobile',
    'hasTouch',
    'deviceScaleFactor',
    'userAgent',
    'timezoneId',
    'locale',
  ] as const) {
    if (use[key] !== undefined) Object.assign(options, { [key]: use[key] });
  }
  return browser.newContext(options);
}

async function signIn(p: Page, address: string, secret: string): Promise<void> {
  await p.getByLabel(text('auth.email')).fill(address);
  await p.getByLabel(text('auth.password'), { exact: true }).fill(secret);
  await p.getByRole('button', { name: text('auth.sign_in.submit') }).click();
}

const heading = (p: Page, name: string) => p.getByRole('heading', { level: 1, name });

test.beforeAll(async ({ browser }, info) => {
  email = `e2e-${info.project.name}-${Date.now()}@example.test`;
  context = await freshContext(browser);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test('signs up, reading and accepting the published documents', async () => {
  await page.goto('/sign-up');
  await expect(heading(page, text('auth.sign_up.title'))).toBeVisible();
  await expectAccessible(page);

  // Exactly what registration requires is offered — not the customer's terms, which bind a role,
  // nor the agency agreement, which binds an agency.
  for (const d of REGISTRATION) {
    await expect(page.getByText(d.title, { exact: true })).toBeVisible();
  }
  for (const d of PUBLISHED.filter((p) => !REGISTRATION.some((r) => r.type === p.type))) {
    await expect(page.getByText(d.title)).toHaveCount(0);
  }

  // Each reads in full in place.
  await page.getByText(REGISTRATION[0]!.title, { exact: true }).click();
  await expect(page.getByText(`${REGISTRATION[0]!.title}. Written for the browser`)).toBeVisible();

  await page.getByLabel(text('auth.email')).fill(email);
  await page.getByLabel(text('auth.password'), { exact: true }).fill(password);
  await page.getByLabel(text('auth.sign_up.accept')).check();
  const since = mark();
  await page.getByRole('button', { name: text('auth.sign_up.submit') }).click();

  await expect(page).toHaveURL(/\/check-email$/);
  await expect(heading(page, text('auth.check_email.title'))).toBeVisible();
  await expectAccessible(page);
  await link(since, email, 'email_verification');

  // What was recorded is what was shown: these versions, in English, at registration.
  const sql = owner();
  try {
    const rows = await sql<{ document_type: string; locale_shown: string; context: string }[]>`
      SELECT c.document_type, c.locale_shown, c.context
        FROM user_consents c JOIN users u ON u.id = c.user_id
       WHERE u.email = ${email}
       ORDER BY c.document_type`;
    expect(rows).toEqual(
      REGISTRATION.map((d) => ({
        document_type: d.type,
        locale_shown: 'en',
        context: 'REGISTRATION',
      })).sort((a, b) => a.document_type.localeCompare(b.document_type)),
    );
  } finally {
    await sql.end();
  }
});

test('confirms the address from the emailed link', async () => {
  // The registration's own link: a resend would retire it, so it is taken fresh from the start.
  const url = await link(0, email, 'email_verification');
  await page.goto(url);
  await expect(heading(page, text('auth.verify.title'))).toBeVisible();
  // The token leaves the address bar on load, so it is not in history or a shared screenshot.
  await expect(page).toHaveURL(/\/verify-email$/);
  await expectAccessible(page);

  await page.getByRole('button', { name: text('auth.verify.submit') }).click();
  await expect(page.getByText(text('auth.verify.done'))).toBeVisible();
  await page.getByRole('link', { name: text('auth.verify.continue') }).click();

  await expect(page).toHaveURL(/\/sign-in\?verified=1$/);
  await expect(page.getByText(text('auth.sign_in.verified'))).toBeVisible();
  await expectAccessible(page);

  // Spent: the same link a second time is refused, and says how to get a new one.
  await page.goto(url);
  await page.getByRole('button', { name: text('auth.verify.submit') }).click();
  await expect(page.getByText(text('auth.verify.invalid'))).toBeVisible();
  await expect(page.getByRole('link', { name: text('auth.verify.request_new') })).toBeVisible();
});

test('signs in and lands on the page asked for, holding a strict host-only cookie', async () => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);

  // An address nobody registered is refused in the same words as a wrong password (the reset
  // step checks that one), so the screen never says which addresses have accounts. It also keeps
  // this account's sign-ins within the API's five in five minutes.
  await signIn(page, `nobody-${email}`, password);
  await expect(page.getByText(text('auth.sign_in.failed'))).toBeVisible();
  await expectAccessible(page);

  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/account$/);
  await expect(heading(page, text('nav.account'))).toBeVisible();
  await expect(page.getByText(text('account.profile.verified'))).toBeVisible();
  await expectAccessible(page);

  // As the browser holds it — not as the API's unit tests say it is set.
  const cookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: 'Strict',
    secure: true,
    // Host-only: no Domain attribute, so the browser records the host itself, without the
    // leading dot a Domain cookie gets — and never sends it to another subdomain (ADR-0002).
    domain: 'localhost',
    path: '/',
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
});

test('stores the device time zone at sign-up, and saves a new one', async () => {
  await expect(
    page.getByText(text('account.timezone.current', { zone: 'Europe/Berlin' })),
  ).toBeVisible();

  await page
    .getByRole('combobox', { name: text('account.timezone.choose') })
    .selectOption('Asia/Yerevan');
  await page.getByRole('button', { name: text('account.timezone.save') }).click();
  await expect(page.getByRole('status')).toHaveText(text('account.timezone.saved'));
  await expect(
    page.getByText(text('account.timezone.current', { zone: 'Asia/Yerevan' })),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByText(text('account.timezone.current', { zone: 'Asia/Yerevan' })),
  ).toBeVisible();
  // The device's own zone is now the one offered.
  await expect(
    page.getByRole('button', {
      name: text('account.timezone.use_detected', { zone: 'Europe/Berlin' }),
    }),
  ).toBeVisible();
});

test('adds the customer role, accepting the document it requires', async () => {
  const add = page.getByRole('button', {
    name: `${text('account.roles.add_customer')} — ${text('account.roles.add_submit')}`,
  });
  const form = page.locator('form').filter({ has: add });
  await expect(form.getByText(CUSTOMER_TERMS.title, { exact: true })).toBeVisible();

  // Not accepted: the browser holds the form back, and nothing is sent.
  await add.click();
  await expect(
    page.getByRole('listitem').filter({ hasText: text('account.roles.customer') }),
  ).toHaveCount(0);

  await form.getByLabel(text('account.roles.accept')).check();
  await add.click();
  await expect(
    page.getByRole('listitem').filter({ hasText: text('account.roles.customer') }),
  ).toBeVisible();
  await expect(add).toHaveCount(0);
  await expectAccessible(page);
});

test('restores the saved language on a fresh browser', async ({ browser }) => {
  await page.getByRole('button', { name: localeName('hy') }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hy');
  await expect(heading(page, text('nav.account', {}, 'hy'))).toBeVisible();

  // No cookies at all, and a browser that asks for English: the account's choice wins at sign-in.
  const fresh = await freshContext(browser);
  try {
    const other = await fresh.newPage();
    await other.goto('/account');
    await expect(other.locator('html')).toHaveAttribute('lang', 'en');
    await signIn(other, email, password);
    await expect(other).toHaveURL(/\/account$/);
    await expect(other.locator('html')).toHaveAttribute('lang', 'hy');
    await expect(heading(other, text('nav.account', {}, 'hy'))).toBeVisible();
  } finally {
    await fresh.close();
  }

  // Back to English, saved again, so the steps after this read the English catalog.
  await page.getByRole('button', { name: localeName('en') }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('ends the session on another device', async ({ browser }) => {
  const second = await freshContext(browser);
  try {
    const other = await second.newPage();
    await other.goto('/sign-in');
    await signIn(other, email, password);
    await expect(other).not.toHaveURL(/\/sign-in/);

    await page.reload();
    const sessions = page.locator('#sessions li');
    // This device, the one just signed in, and the fresh browser of the step before.
    await expect(sessions).toHaveCount(3);
    await expect(sessions.first()).toContainText(text('account.sessions.this_device'));

    const others = page.getByRole('button', {
      name: text('account.sessions.sign_out_other'),
      exact: true,
    });
    await others.first().click();
    await expect(sessions).toHaveCount(2);
    await others.first().click();
    await expect(sessions).toHaveCount(1);
    await expect(sessions.first()).toContainText(text('account.sessions.this_device'));

    // The other device's next request finds no session.
    await other.goto('/account');
    await expect(other).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  } finally {
    await second.close();
  }
});

test('signs out on this device', async () => {
  await page.getByRole('button', { name: text('account.sessions.sign_out_here') }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.cookies()).map((c) => c.name)).not.toContain(SESSION_COOKIE);

  await page.goto('/account');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
});

test('resets the password from the emailed link', async () => {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: text('auth.sign_in.forgot') }).click();
  await expect(heading(page, text('auth.forgot.title'))).toBeVisible();
  await expectAccessible(page);

  await page.getByLabel(text('auth.email')).fill(email);
  const since = mark();
  await page.getByRole('button', { name: text('auth.forgot.submit') }).click();
  await expect(page.getByText(text('auth.forgot.sent'))).toBeVisible();

  await page.goto(await link(since, email, 'password_reset'));
  await expect(heading(page, text('auth.reset.title'))).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  await expectAccessible(page);

  const next = 'a long second password';
  await page.getByLabel(text('auth.reset.password'), { exact: true }).fill(next);
  await page.getByLabel(text('auth.reset.confirm')).fill('a different second password');
  await page.getByRole('button', { name: text('auth.reset.submit') }).click();
  await expect(page.getByText(text('auth.reset.mismatch'))).toBeVisible();

  await page.getByLabel(text('auth.reset.confirm')).fill(next);
  await page.getByRole('button', { name: text('auth.reset.submit') }).click();
  await expect(page).toHaveURL(/\/sign-in\?reset=done$/);
  await expect(page.getByText(text('auth.sign_in.reset_done'))).toBeVisible();

  await signIn(page, email, password);
  await expect(page.getByText(text('auth.sign_in.failed'))).toBeVisible();

  password = next;
  await signIn(page, email, password);
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto('/account');
  await expect(heading(page, text('nav.account'))).toBeVisible();
});
