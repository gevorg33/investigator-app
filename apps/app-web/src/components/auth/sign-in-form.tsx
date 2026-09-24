'use client';

import { useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { navigate } from '@/lib/navigate';

/**
 * Signing in. Every refusal reads the same — wrong password, no such account, suspended, a
 * malformed field — so the form never tells anyone whether an address is registered (T-005).
 */
export function SignInForm({ next }: { next: string }) {
  const t = useTranslations();
  const { pending, error, onSubmit } = useSubmit(
    (form) =>
      callApi('/auth/login', {
        body: { email: form.get('email'), password: form.get('password') },
      }),
    () => navigate(`/session/start?next=${encodeURIComponent(next)}`),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError
        error={error}
        overrides={{
          UNAUTHENTICATED: 'auth.sign_in.failed',
          VALIDATION_FAILED: 'auth.sign_in.failed',
        }}
      />
      <Field
        label={t('auth.email')}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
      />
      <Field
        label={t('auth.password')}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('auth.sign_in.submit')}
      </Button>
    </form>
  );
}
