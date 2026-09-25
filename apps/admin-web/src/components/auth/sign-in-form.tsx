'use client';

import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/messages';
import { callApi } from '@/lib/api/browser';
import { navigate } from '@/lib/navigate';

/**
 * Staff sign-in (T-070). The same sign-in as the app — the API sets the session cookie on this
 * origin, host-only, so a console session is never the app's (ADR-0002). Every refusal reads the
 * same: the form never says whether an address is registered, or whether it is staff.
 */
export function SignInForm({ next }: { next: string }) {
  const { pending, error, onSubmit } = useSubmit(
    (form) =>
      callApi('/auth/login', {
        body: { email: form.get('email'), password: form.get('password') },
      }),
    () => navigate(next),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError
        error={error}
        overrides={{ UNAUTHENTICATED: 'sign_in.failed', VALIDATION_FAILED: 'sign_in.failed' }}
      />
      <Field
        label={t('sign_in.email')}
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
      />
      <Field
        label={t('sign_in.password')}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('sign_in.submit')}
      </Button>
    </form>
  );
}
