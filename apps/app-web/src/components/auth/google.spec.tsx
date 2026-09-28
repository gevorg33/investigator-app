import { catalogs } from '@investigator/i18n';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GoogleSignUpPage, { generateMetadata } from '@/app/(auth)/sign-up/google/page';
import SignInPage from '@/app/(auth)/sign-in/page';
import SignUpPage from '@/app/(auth)/sign-up/page';
import { SignInMethods } from '@/components/account/sign-in-methods';
import { navigate } from '@/lib/navigate';
import { api, apiError } from '@/test/api';
import { account, legalDocument } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { GoogleButton } from './google-button';
import { GoogleSignupForm } from './google-signup-form';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('@/lib/navigate', () => ({
  navigate: vi.fn(),
  deviceTimeZone: () => 'Asia/Yerevan',
}));

const en = catalogs.en;
const search = <T,>(params: T) => ({ searchParams: Promise.resolve(params) });
const signedOut = () =>
  api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
const googleOn = (on = true) => api.on('GET /auth/providers', 200, { google: on });
const show = async (node: Promise<React.ReactNode>) => renderIntl(await resolveServer(await node));
const formOf = (name: string) => screen.getByRole('button', { name }).closest('form')!;

beforeEach(() => {
  request.reset();
  api.install();
  router.reset();
  vi.mocked(navigate).mockReset();
});

describe('Sign in with Google (T-062)', () => {
  describe('the button', () => {
    it('is a plain GET form to the API, carrying where to come back to', () => {
      const { rerender } = render(<GoogleButton label="Go" next="/missions?x=1" />);
      const form = formOf('Go');
      expect(form).toHaveAttribute('method', 'get');
      expect(form).toHaveAttribute('action', '/api/v1/auth/google/start');
      expect(form.querySelector('input[name=next]')).toHaveValue('/missions?x=1');
      // Home is where it comes back to anyway: nothing to carry.
      rerender(<GoogleButton label="Go" />);
      expect(formOf('Go').querySelector('input[name=next]')).toBeNull();
    });
  });

  describe('on the sign-in and sign-up pages', () => {
    it('is offered when Google is configured, keeping where the reader was going', async () => {
      signedOut();
      googleOn();
      await show(SignInPage(search({ next: '/missions' })));
      const form = formOf(en.auth.google.continue);
      expect(form.querySelector('input[name=next]')).toHaveValue('/missions');
      expect(screen.getByText(en.auth.google.or)).toBeInTheDocument();
    });

    it('is not offered when it is not configured', async () => {
      signedOut();
      googleOn(false);
      await show(SignInPage(search({})));
      expect(screen.queryByRole('button', { name: en.auth.google.continue })).toBeNull();
    });

    it.each(['denied', 'failed', 'unverified', 'exists'] as const)(
      'says what went wrong: %s',
      async (reason) => {
        signedOut();
        googleOn();
        await show(SignInPage(search({ google: reason })));
        expect(screen.getByRole('alert')).toHaveTextContent(en.auth.google[reason]);
      },
    );

    it('says nothing for a reason it does not know', async () => {
      signedOut();
      googleOn();
      await show(SignInPage(search({ google: '<script>' })));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('is offered on sign-up too, before the email form', async () => {
      signedOut();
      googleOn();
      api.on('GET /legal/required?for=registration&locale=en', 200, []);
      await show(SignUpPage(search({})));
      const buttons = screen.getAllByRole('button').map((b) => b.textContent);
      expect(buttons[0]).toBe(en.auth.google.continue);
      expect(buttons).toContain(en.auth.sign_up.submit);
    });

    it('offers sign-up without Google, and with nothing to accept', async () => {
      signedOut();
      googleOn(false);
      api.on('GET /legal/required?for=registration&locale=en', 204);
      await show(SignUpPage(search({})));
      expect(screen.queryByRole('button', { name: en.auth.google.continue })).toBeNull();
      expect(screen.getByRole('button', { name: en.auth.sign_up.submit })).toBeVisible();
    });
  });

  describe('completing a first sign-in', () => {
    const TERMS = legalDocument({ id: '00000000-0000-4000-8000-0000000000d1' });
    const complete = 'POST /auth/google/complete';

    it('shows whose account it creates and the documents, then creates it and signs in', async () => {
      api.on('GET /auth/google/pending', 200, { email: 'ana@example.test' });
      api.on(complete, 200, { userId: 'u-new' });
      renderIntl(<GoogleSignupForm documents={[TERMS]} next="/missions" />);
      expect(
        await screen.findByText(
          'Your account will use ana@example.test, which Google has confirmed.',
        ),
      ).toBeVisible();
      const u = userEvent.setup();
      await u.click(screen.getByRole('checkbox', { name: en.auth.sign_up.accept }));
      await u.click(screen.getByRole('button', { name: en.auth.sign_up.submit }));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session/start?next=%2Fmissions'));
      expect(api.calls.find((c) => c.path === '/auth/google/complete')!.body).toEqual({
        acceptedDocumentIds: [TERMS.id],
        locale: 'en',
        timezone: 'Asia/Yerevan',
      });
    });

    it('says what the API refused, and stays', async () => {
      api.on('GET /auth/google/pending', 200, { email: 'ana@example.test' });
      api.on(complete, 422, apiError('VALIDATION_FAILED', 'error.common.validation_failed'));
      renderIntl(<GoogleSignupForm documents={[]} />);
      await userEvent
        .setup()
        .click(await screen.findByRole('button', { name: en.auth.sign_up.submit }));
      expect(await screen.findByRole('alert')).toHaveTextContent(en.error.common.validation_failed);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('says a sign-up has lapsed, whether found so on arrival or on sending', async () => {
      api.on('GET /auth/google/pending', 404, apiError('NOT_FOUND', 'error.common.not_found'));
      const { unmount } = renderIntl(<GoogleSignupForm documents={[]} />);
      expect(await screen.findByText(en.auth.google.signup_expired)).toBeVisible();
      expect(screen.getByRole('link', { name: en.auth.google.start_again })).toHaveAttribute(
        'href',
        '/sign-in',
      );
      unmount();

      api.on('GET /auth/google/pending', 200, { email: 'ana@example.test' });
      api.on(complete, 409, apiError('STATE_CONFLICT', 'error.common.state_conflict'));
      renderIntl(<GoogleSignupForm documents={[]} />);
      await userEvent
        .setup()
        .click(await screen.findByRole('button', { name: en.auth.sign_up.submit }));
      expect(await screen.findByText(en.auth.google.signup_expired)).toBeVisible();
    });

    it('is its own page, titled, for someone not yet signed in', async () => {
      signedOut();
      api.on('GET /legal/required?for=registration&locale=en', 200, [TERMS]);
      api.on('GET /auth/google/pending', 200, { email: 'ana@example.test' });
      await show(GoogleSignUpPage(search({ next: '/missions' })));
      expect(
        screen.getByRole('heading', { level: 1, name: en.auth.google.signup_title }),
      ).toBeVisible();
      expect((await generateMetadata()).title).toBe(en.auth.google.signup_title);
    });

    it('asks nothing to be accepted when nothing is published', async () => {
      signedOut();
      api.on('GET /legal/required?for=registration&locale=en', 204);
      api.on('GET /auth/google/pending', 200, { email: 'ana@example.test' });
      await show(GoogleSignUpPage(search({})));
      expect(await screen.findByRole('button', { name: en.auth.sign_up.submit })).toBeVisible();
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('sends someone already signed in on', async () => {
      api.on('GET /me', 200, account());
      await expect(GoogleSignUpPage(search({ next: '/missions' }))).rejects.toEqual(
        new Redirected('/missions'),
      );
    });
  });

  describe('sign-in methods on the account page', () => {
    const t = en.account.sign_in;
    const methods = (over: { password?: boolean; google?: string | null } = {}) =>
      api.on('GET /auth/identities', 200, {
        password: over.password ?? true,
        identities:
          over.google === null
            ? []
            : [
                {
                  id: '00000000-0000-4000-8000-0000000000e1',
                  provider: 'GOOGLE',
                  email: over.google ?? 'ana@gmail.test',
                  createdAt: '2026-09-28T10:00:00.000Z',
                  lastUsedAt: null,
                },
              ],
      });
    const section = async (outcome?: string) => {
      renderIntl(await resolveServer(await SignInMethods({ outcome })));
      return screen.getByRole('region', { name: t.title });
    };

    it('says a password is set, and which Google account is connected', async () => {
      methods();
      googleOn();
      const s = await section();
      expect(s).toHaveTextContent(t.password_set);
      expect(s).toHaveTextContent('Connected as ana@gmail.test');
      expect(within(s).getByRole('button', { name: t.disconnect })).toBeVisible();
      expect(within(s).queryByRole('button', { name: t.connect })).toBeNull();
    });

    it('offers to connect Google, back to the account page', async () => {
      methods({ google: null, password: false });
      googleOn();
      const s = await section();
      expect(s).toHaveTextContent(t.password_unset);
      expect(s).toHaveTextContent(t.google_none);
      const form = within(s).getByRole('button', { name: t.connect }).closest('form')!;
      expect(form).toHaveAttribute('action', '/api/v1/auth/google/link');
      expect(form.querySelector('input[name=next]')).toHaveValue('/account');
    });

    it('does not offer to connect when Google is not configured', async () => {
      methods({ google: null });
      googleOn(false);
      const s = await section();
      expect(within(s).queryByRole('button')).toBeNull();
    });

    it('names a connected account whose address Google did not give', async () => {
      api.on('GET /auth/identities', 200, {
        password: true,
        identities: [{ id: 'i', provider: 'GOOGLE', email: null, createdAt: '', lastUsedAt: null }],
      });
      googleOn();
      expect(await section()).toHaveTextContent('Connected as');
    });

    it.each([
      ['linked', 'status'],
      ['taken', 'alert'],
      ['failed', 'alert'],
      ['denied', 'alert'],
    ] as const)('says how connecting went: %s', async (outcome, role) => {
      methods();
      googleOn();
      const s = await section(outcome);
      expect(within(s).getByRole(role)).toHaveTextContent(t[outcome]);
    });

    it('says nothing for an outcome it does not know', async () => {
      methods();
      googleOn();
      const s = await section('anything');
      expect(within(s).queryByRole('status')).toBeNull();
      expect(within(s).queryByRole('alert')).toBeNull();
    });

    it('disconnects Google after asking, and refreshes', async () => {
      methods();
      googleOn();
      api.on('DELETE /auth/identities/00000000-0000-4000-8000-0000000000e1', 204);
      const s = await section();
      const u = userEvent.setup();
      await u.click(within(s).getByRole('button', { name: t.disconnect }));
      expect(screen.getByRole('alertdialog', { name: t.disconnect_title })).toHaveTextContent(
        t.disconnect_body,
      );
      await u.click(screen.getByRole('button', { name: t.disconnect_confirm }));
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    });

    it('keeps it when the reader changes their mind, and gives focus back', async () => {
      methods();
      googleOn();
      const s = await section();
      const u = userEvent.setup();
      await u.click(within(s).getByRole('button', { name: t.disconnect }));
      await u.click(screen.getByRole('button', { name: t.keep }));
      expect(within(s).getByRole('button', { name: t.disconnect })).toHaveFocus();
      expect(api.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    });

    it('says why it cannot disconnect the last way in, and how to add another', async () => {
      methods({ password: false });
      googleOn();
      api.on(
        'DELETE /auth/identities/00000000-0000-4000-8000-0000000000e1',
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
          details: [
            {
              field: 'identity',
              code: 'LAST_METHOD',
              messageKey: 'error.validation.identity.last_method',
            },
          ],
        }),
      );
      const s = await section();
      const u = userEvent.setup();
      await u.click(within(s).getByRole('button', { name: t.disconnect }));
      await u.click(screen.getByRole('button', { name: t.disconnect_confirm }));
      expect(await within(s).findByRole('alert')).toHaveTextContent(
        en.error.validation.identity.last_method,
      );
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('treats no answer at all as a failure it can name', async () => {
      methods();
      googleOn();
      api.down('DELETE /auth/identities/00000000-0000-4000-8000-0000000000e1');
      const s = await section();
      const u = userEvent.setup();
      await u.click(within(s).getByRole('button', { name: t.disconnect }));
      await u.click(screen.getByRole('button', { name: t.disconnect_confirm }));
      expect(await within(s).findByRole('alert')).toHaveTextContent(en.error.common.internal);
    });
  });
});
