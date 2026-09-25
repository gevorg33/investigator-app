import { catalogs, type Locale } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { account, legalDocument } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { Redirected } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import CheckEmailPage, { generateMetadata as checkEmailMeta } from './check-email/page';
import ForgotPasswordPage, { generateMetadata as forgotMeta } from './forgot-password/page';
import AuthLayout from './layout';
import ResetPasswordPage, { generateMetadata as resetMeta } from './reset-password/page';
import SignInPage, { generateMetadata as signInMeta } from './sign-in/page';
import SignUpPage, { generateMetadata as signUpMeta } from './sign-up/page';
import VerifyEmailPage, { generateMetadata as verifyMeta } from './verify-email/page';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en;
const search = <T,>(params: T) => ({ searchParams: Promise.resolve(params) });
const signedOut = () =>
  api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
const show = async (page: Promise<React.ReactNode> | React.ReactNode, locale: Locale = 'en') =>
  renderIntl(await resolveServer(await page), locale);

describe('the signed-out screens', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });

  it('frame one column, with the language choosable before anything else is read', async () => {
    request.cookies.set('locale', 'hy');
    await show(AuthLayout({ children: <p>screen</p> }), 'hy');
    expect(screen.getByText(catalogs.hy.app.name)).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'content');
    const choice = screen.getByRole('navigation', { name: catalogs.hy.account.language.title });
    expect(within(choice).getByRole('button', { name: 'Հայերեն', pressed: true })).toBeVisible();
    // Compact: no card, no heading — the same control, fitted to the footer.
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it.each([
    [signInMeta, en.auth.sign_in.title, undefined],
    [signUpMeta, en.auth.sign_up.title, undefined],
    [checkEmailMeta, en.auth.check_email.title, undefined],
    [forgotMeta, en.auth.forgot.title, undefined],
    // A page whose URL carries a token never sends that URL onward as a Referer.
    [verifyMeta, en.auth.verify.title, 'no-referrer'],
    [resetMeta, en.auth.reset.title, 'no-referrer'],
  ])('titles each page in the reader’s language (%#)', async (meta, title, referrer) => {
    const m = await meta();
    expect(m.title).toBe(title);
    expect(m.referrer).toBe(referrer);
  });
});

describe('the sign-in page', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });

  it('sends someone already signed in straight on, never off-site', async () => {
    request.cookies.set('investigator_session', 'tok');
    api.on('GET /me', 200, account());
    await expect(SignInPage(search({ next: '/missions' }))).rejects.toEqual(
      new Redirected('/missions'),
    );
    await expect(SignInPage(search({ next: '//evil.test' }))).rejects.toEqual(new Redirected('/'));
  });

  it('offers the way back in, and the ways around it', async () => {
    signedOut();
    await show(SignInPage(search({})));
    expect(screen.getByRole('heading', { level: 1, name: en.auth.sign_in.title })).toBeVisible();
    expect(screen.getByRole('button', { name: en.auth.sign_in.submit })).toBeVisible();
    expect(screen.getByRole('link', { name: en.auth.sign_in.forgot })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: en.auth.sign_in.create_account })).toHaveAttribute(
      'href',
      '/sign-up',
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    [{ reset: 'done' }, en.auth.sign_in.reset_done],
    [{ verified: '1' }, en.auth.sign_in.verified],
  ])('says what just happened (%o)', async (params, notice) => {
    signedOut();
    await show(SignInPage(search(params)));
    expect(screen.getByRole('status')).toHaveTextContent(notice);
  });
});

describe('the sign-up page', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });

  it('sends someone already signed in home', async () => {
    request.cookies.set('investigator_session', 'tok');
    api.on('GET /me', 200, account());
    await expect(SignUpPage()).rejects.toEqual(new Redirected('/'));
  });

  it('shows what registration requires, as the API says, in the reader’s language', async () => {
    request.cookies.set('locale', 'ru');
    signedOut();
    api.on('GET /legal/required?for=registration&locale=ru', 200, [
      legalDocument({ locale: 'ru', title: 'Политика конфиденциальности' }),
    ]);
    await show(SignUpPage(), 'ru');
    const ru = catalogs.ru;
    expect(screen.getByRole('heading', { level: 1, name: ru.auth.sign_up.title })).toBeVisible();
    expect(screen.getByText('Политика конфиденциальности')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: ru.auth.sign_up.accept })).toBeRequired();
    expect(screen.getByRole('link', { name: ru.auth.sign_up.sign_in })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it('asks nothing to be accepted when the API has nothing to show', async () => {
    signedOut();
    api.on('GET /legal/required?for=registration&locale=en', 204);
    await show(SignUpPage());
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('the pages email links open', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });

  it('check-email explains what happens next, and offers to send again', async () => {
    await show(CheckEmailPage());
    expect(screen.getByText(en.auth.check_email.body)).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: en.auth.check_email.resend_title }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: en.auth.check_email.resend_submit })).toBeVisible();
  });

  it('forgot-password asks for the address, and leads back to sign-in', async () => {
    await show(ForgotPasswordPage());
    expect(screen.getByRole('button', { name: en.auth.forgot.submit })).toBeVisible();
    expect(screen.getByRole('link', { name: en.auth.forgot.back })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it.each([
    ['verify-email', VerifyEmailPage, en.auth.verify.submit, en.auth.verify, '/check-email'],
    ['reset-password', ResetPasswordPage, en.auth.reset.submit, en.auth.reset, '/forgot-password'],
  ])(
    '%s acts on its token, and asks for a new link without one',
    async (_, Page, submit, copy, again) => {
      await show(Page(search({ token: 'tok' })));
      expect(screen.getByRole('button', { name: submit })).toBeVisible();
      document.body.innerHTML = '';

      await show(Page(search({})));
      expect(screen.getByText(copy.missing)).toBeVisible();
      expect(screen.getByRole('link', { name: copy.request_new })).toHaveAttribute('href', again);
      expect(screen.queryByRole('button')).toBeNull();
    },
  );
});
