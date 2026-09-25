'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';

/**
 * "Send me a link": a new verification email, or a password reset. The API answers the same for
 * every address, registered or not, and so does this form — `done` is worded as "if this address
 * can be used", never "we found your account".
 */
export function EmailLinkForm({
  endpoint,
  submit,
  done,
}: {
  endpoint: '/auth/verify-email/resend' | '/auth/password-reset';
  submit: string;
  done: string;
}) {
  const t = useTranslations();
  const [sent, setSent] = useState(false);
  const { pending, error, onSubmit } = useSubmit(
    (form) => callApi(endpoint, { body: { email: form.get('email') } }),
    () => setSent(true),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError
        error={error}
        overrides={{ VALIDATION_FAILED: 'error.validation.email.invalid' }}
      />
      {sent && (
        <Alert>
          <AlertContent>
            <AlertTitle>{done}</AlertTitle>
          </AlertContent>
        </Alert>
      )}
      <Field
        label={t('auth.email')}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {submit}
      </Button>
    </form>
  );
}
