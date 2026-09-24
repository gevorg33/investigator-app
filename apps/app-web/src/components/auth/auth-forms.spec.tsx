import { catalogs } from '@investigator/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetQuery, navigate } from '@/lib/navigate';
import { api, apiError } from '@/test/api';
import { legalDocument } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { EmailLinkForm } from './email-link-form';
import { ResetPasswordForm } from './reset-password-form';
import { SignInForm } from './sign-in-form';
import { SignUpForm } from './sign-up-form';
import { VerifyEmail } from './verify-email';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('@/lib/navigate', () => ({
  navigate: vi.fn(),
  forgetQuery: vi.fn(),
  deviceTimeZone: vi.fn(() => 'Asia/Yerevan'),
}));

const en = catalogs.en;
const validation = (...fields: Array<[string, string?]>) =>
  apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
    details: fields.map(([field, messageKey = 'error.common.validation_failed']) => ({
      field,
      code: 'invalid',
      messageKey,
    })),
  });

beforeEach(() => {
  api.install();
  router.reset();
  vi.mocked(navigate).mockReset();
  vi.mocked(forgetQuery).mockReset();
});

describe('signing in', () => {
  const signIn = async (email = 'ana@example.test', password = 'correct horse battery') => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en.auth.email), email);
    await user.type(screen.getByLabelText(en.auth.password), password);
    await user.click(screen.getByRole('button', { name: en.auth.sign_in.submit }));
  };

  it('sends the credentials, then lands where the account’s language is restored', async () => {
    api.on('POST /auth/login', 200, { userId: 'u-1' });
    renderIntl(<SignInForm next="/missions?tab=open" />);
    expect(screen.getByLabelText(en.auth.email)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(en.auth.password)).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    await signIn();
    expect(api.calls).toMatchObject([
      {
        method: 'POST',
        path: '/auth/login',
        body: { email: 'ana@example.test', password: 'correct horse battery' },
      },
    ]);
    expect(navigate).toHaveBeenCalledWith('/session/start?next=%2Fmissions%3Ftab%3Dopen');
  });

  it.each([
    [
      'a wrong password or an unknown address',
      401,
      apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'),
    ],
    ['a malformed address', 422, validation(['email'])],
  ])('says the same for %s — never whether the address is registered', async (_, status, body) => {
    api.on('POST /auth/login', status, body);
    renderIntl(<SignInForm next="/" />);
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.sign_in.failed);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Reference/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says when there have been too many attempts', async () => {
    api.on('POST /auth/login', 429, apiError('RATE_LIMITED', 'error.common.rate_limited'));
    renderIntl(<SignInForm next="/" />);
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.error.common.rate_limited);
  });

  it('reports a dropped connection instead of doing nothing', async () => {
    api.down('POST /auth/login');
    renderIntl(<SignInForm next="/" />);
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.error.common.internal);
  });

  it('sends once, however often it is pressed, and says it is busy meanwhile', async () => {
    const release = api.hold('POST /auth/login', 200, { userId: 'u-1' });
    renderIntl(<SignInForm next="/" />);
    await signIn();
    const button = screen.getByRole('button', { name: en.auth.sign_in.submit });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.submit(button.closest('form')!);
    await act(async () => release());
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(api.calls).toHaveLength(1);
    expect(button).toBeEnabled();
  });
});

describe('signing up', () => {
  const documents = [
    legalDocument(),
    legalDocument({ id: 'doc-terms-2-en', type: 'TERMS_OF_SERVICE', title: 'Terms of service' }),
  ];

  const signUp = async (accept = true) => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en.auth.email), 'ana@example.test');
    await user.type(screen.getByLabelText(en.auth.password), 'a long enough password');
    if (accept) await user.click(screen.getByRole('checkbox', { name: en.auth.sign_up.accept }));
    await user.click(screen.getByRole('button', { name: en.auth.sign_up.submit }));
  };

  it('accepts exactly the versions shown, and saves the screen’s language and the device’s zone', async () => {
    api.on('POST /auth/register', 202);
    renderIntl(<SignUpForm documents={documents} />, 'ru');
    const ru = catalogs.ru;
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(ru.auth.email), 'ana@example.test');
    await user.type(screen.getByLabelText(ru.auth.password), 'a long enough password');
    await user.click(screen.getByRole('checkbox', { name: ru.auth.sign_up.accept }));
    await user.click(screen.getByRole('button', { name: ru.auth.sign_up.submit }));
    expect(api.calls[0]!.body).toEqual({
      email: 'ana@example.test',
      password: 'a long enough password',
      acceptedDocumentIds: ['doc-privacy-3-en', 'doc-terms-2-en'],
      locale: 'ru',
      timezone: 'Asia/Yerevan',
    });
    // The same next step whether or not the address was already registered.
    expect(router.push).toHaveBeenCalledWith('/check-email');
  });

  it('cannot be sent without accepting — the browser holds it back', async () => {
    renderIntl(<SignUpForm documents={documents} />);
    await signUp(false);
    expect(api.calls).toEqual([]);
    expect(screen.getByLabelText(en.auth.password)).toHaveAttribute('minlength', '12');
    expect(screen.getByLabelText(en.auth.password)).toHaveAccessibleDescription(
      en.auth.password_hint,
    );
  });

  it('puts each refusal where it belongs: on its field, or naming the document', async () => {
    api.on(
      'POST /auth/register',
      422,
      validation(
        ['email'],
        ['password'],
        ['acceptedDocumentIds', 'error.validation.legal.privacy_policy'],
      ),
    );
    renderIntl(<SignUpForm documents={documents} />);
    await signUp();
    expect(await screen.findByText(en.error.validation.legal.privacy_policy)).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.email)).toHaveAccessibleDescription(
      en.error.validation.email.invalid,
    );
    expect(screen.getByLabelText(en.auth.password)).toHaveAccessibleDescription(
      `${en.auth.password_hint} ${en.error.validation.password.too_short}`,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(en.error.common.validation_failed);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('asks for nothing to be accepted when nothing is published', async () => {
    api.on('POST /auth/register', 202);
    renderIntl(<SignUpForm documents={[]} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await signUp(false);
    expect(api.calls[0]!.body).toMatchObject({ acceptedDocumentIds: [] });
  });
});

describe('asking for a link by email', () => {
  it.each([
    ['/auth/verify-email/resend', 'Send again', 'Maybe sent'],
    ['/auth/password-reset', 'Send the link', 'If it exists'],
  ] as const)('%s answers the same for every address', async (endpoint, submit, done) => {
    api.on(`POST ${endpoint}`, 202);
    renderIntl(<EmailLinkForm endpoint={endpoint} submit={submit} done={done} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en.auth.email), 'who@example.test');
    await user.click(screen.getByRole('button', { name: submit }));
    expect(await screen.findByRole('status')).toHaveTextContent(done);
    expect(api.calls[0]).toMatchObject({ path: endpoint, body: { email: 'who@example.test' } });
  });

  it('says what is wrong with an address the API refuses', async () => {
    api.on('POST /auth/password-reset', 422, validation(['email']));
    renderIntl(<EmailLinkForm endpoint="/auth/password-reset" submit="Send" done="Sent" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en.auth.email), 'who@example.test');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.error.validation.email.invalid);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('confirming an email address', () => {
  it('takes the token out of the address bar, and spends it only when its owner presses', async () => {
    api.on('POST /auth/verify-email', 200, { status: 'verified' });
    renderIntl(<VerifyEmail token="tok-1" />);
    expect(forgetQuery).toHaveBeenCalled();
    // A mail scanner opening the link redeems nothing.
    expect(api.calls).toEqual([]);
    await userEvent.setup().click(screen.getByRole('button', { name: en.auth.verify.submit }));
    expect(api.calls[0]).toMatchObject({ path: '/auth/verify-email', body: { token: 'tok-1' } });
    expect(await screen.findByRole('status')).toHaveTextContent(en.auth.verify.done);
    expect(screen.getByRole('link', { name: en.auth.verify.continue })).toHaveAttribute(
      'href',
      '/sign-in?verified=1',
    );
  });

  it('offers a new link when this one has expired or been used', async () => {
    api.on(
      'POST /auth/verify-email',
      401,
      apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'),
    );
    renderIntl(<VerifyEmail token="used" />);
    await userEvent.setup().click(screen.getByRole('button', { name: en.auth.verify.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.verify.invalid);
    expect(screen.getByRole('link', { name: en.auth.verify.request_new })).toHaveAttribute(
      'href',
      '/check-email',
    );
  });

  it('offers no new link for a failure a new link would not fix', async () => {
    api.on(
      'POST /auth/verify-email',
      503,
      apiError('SERVICE_UNAVAILABLE', 'error.common.service_unavailable'),
    );
    renderIntl(<VerifyEmail token="t" />);
    await userEvent.setup().click(screen.getByRole('button', { name: en.auth.verify.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.error.common.service_unavailable);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('choosing a new password', () => {
  const choose = async (password: string, confirm: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en.auth.reset.password), password);
    await user.type(screen.getByLabelText(en.auth.reset.confirm), confirm);
    await user.click(screen.getByRole('button', { name: en.auth.reset.submit }));
  };

  it('says first that saving signs out everywhere, and sends to sign-in after', async () => {
    api.on('POST /auth/password-reset/confirm', 200, { status: 'reset' });
    renderIntl(<ResetPasswordForm token="tok-2" />);
    expect(forgetQuery).toHaveBeenCalled();
    expect(screen.getByText(en.auth.reset.note)).toBeInTheDocument();
    await choose('a brand new password', 'a brand new password');
    expect(api.calls[0]).toMatchObject({
      path: '/auth/password-reset/confirm',
      body: { token: 'tok-2', password: 'a brand new password' },
    });
    expect(navigate).toHaveBeenCalledWith('/sign-in?reset=done');
  });

  it('catches two different passwords before anything is sent', async () => {
    api.on('POST /auth/password-reset/confirm', 200, { status: 'reset' });
    renderIntl(<ResetPasswordForm token="t" />);
    await choose('a brand new password', 'a brand new passwort');
    expect(screen.getByLabelText(en.auth.reset.confirm)).toHaveAccessibleDescription(
      en.auth.reset.mismatch,
    );
    expect(api.calls).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    // Corrected, the message goes and the password is saved.
    await userEvent.setup().clear(screen.getByLabelText(en.auth.reset.confirm));
    await userEvent
      .setup()
      .type(screen.getByLabelText(en.auth.reset.confirm), 'a brand new password');
    await userEvent.setup().click(screen.getByRole('button', { name: en.auth.reset.submit }));
    expect(screen.getByLabelText(en.auth.reset.confirm)).not.toHaveAttribute('aria-invalid');
    expect(api.calls).toHaveLength(1);
  });

  it('offers a new link when this one has expired or been used', async () => {
    api.on(
      'POST /auth/password-reset/confirm',
      401,
      apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'),
    );
    renderIntl(<ResetPasswordForm token="used" />);
    await choose('a brand new password', 'a brand new password');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.reset.invalid);
    expect(screen.getByRole('link', { name: en.auth.reset.request_new })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('says on the field what the API refused about the password', async () => {
    api.on('POST /auth/password-reset/confirm', 422, validation(['password']));
    renderIntl(<ResetPasswordForm token="t" />);
    await choose('short but ok', 'short but ok');
    await screen.findByRole('alert');
    expect(screen.getByLabelText(en.auth.reset.password)).toHaveAccessibleDescription(
      `${en.auth.password_hint} ${en.error.validation.password.too_short}`,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
