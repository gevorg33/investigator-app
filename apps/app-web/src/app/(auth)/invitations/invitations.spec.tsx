import { catalogs } from '@investigator/i18n';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { account } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import InvitationPage, { generateMetadata } from './accept/page';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en;
const search = <T,>(params: T) => ({ searchParams: Promise.resolve(params) });
const signedOut = () =>
  api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
const show = async (page: Promise<React.ReactNode>, locale: 'en' | 'ru' | 'hy' = 'en') =>
  renderIntl(await resolveServer(await page), locale);

it('is titled in the reader’s language, and never sends its tokened URL on as a Referer', async () => {
  const m = await generateMetadata();
  expect([m.title, m.referrer]).toEqual([en.auth.invitation.title, 'no-referrer']);
});

describe('the invitation page (T-158)', () => {
  const inv = en.auth.invitation;
  // The token is escaped inside the way back, and the way back again as a query value.
  const next = `next=${encodeURIComponent(`/invitations/accept?token=${encodeURIComponent('tok 9')}`)}`;

  beforeEach(() => {
    request.reset();
    api.install();
  });

  it('says a link without its token is incomplete, and offers Home', async () => {
    signedOut();
    await show(InvitationPage(search({})));
    expect(screen.getByRole('heading', { level: 1, name: inv.title })).toBeVisible();
    expect(screen.getByText(inv.missing)).toBeVisible();
    expect(screen.getByRole('link', { name: inv.home })).toHaveAttribute('href', '/');
  });

  it('asks someone signed out to sign in or create the account, and keeps the way back', async () => {
    signedOut();
    await show(InvitationPage(search({ token: 'tok 9' })));
    expect(screen.getByText(inv.signed_out)).toBeVisible();
    expect(screen.getByRole('link', { name: inv.sign_in })).toHaveAttribute(
      'href',
      `/sign-in?${next}`,
    );
    expect(screen.getByRole('link', { name: inv.create_account })).toHaveAttribute(
      'href',
      `/sign-up?${next}`,
    );
    expect(screen.queryByRole('button', { name: inv.submit })).toBeNull();
  });

  it('asks an account whose address is not confirmed to confirm it first', async () => {
    request.cookies.set('__Host-investigator_session', 'tok');
    api.on('GET /me', 200, account({ emailVerified: false }));
    await show(InvitationPage(search({ token: 'tok 9' })));
    expect(screen.getByText(inv.unconfirmed.replace('{email}', 'ana@example.test'))).toBeVisible();
    expect(screen.getByRole('link', { name: inv.confirm_link })).toHaveAttribute(
      'href',
      `/check-email?${next}`,
    );
    expect(screen.queryByRole('button', { name: inv.submit })).toBeNull();
  });

  it('offers the invited, confirmed account the button that joins, in its language', async () => {
    request.cookies.set('__Host-investigator_session', 'tok');
    request.cookies.set('locale', 'hy');
    api.on('GET /me', 200, account());
    await show(InvitationPage(search({ token: 'tok 9' })), 'hy');
    const hy = catalogs.hy.auth.invitation;
    expect(screen.getByRole('heading', { level: 1, name: hy.title })).toBeVisible();
    expect(screen.getByRole('button', { name: hy.submit })).toBeVisible();
    // Nothing was accepted by opening the page.
    expect(api.calls.filter((c) => c.path === '/invitations/accept')).toEqual([]);
  });
});
