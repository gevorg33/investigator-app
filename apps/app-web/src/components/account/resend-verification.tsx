'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';

/** A new confirmation link for the signed-in account's own address. */
export function ResendVerification({ email }: { email: string }) {
  const t = useTranslations();
  const [sent, setSent] = useState(false);
  const { pending, error, onSubmit } = useSubmit(
    () => callApi('/auth/verify-email/resend', { body: { email } }),
    () => setSent(true),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <FormError error={error} />
      {sent ? (
        <p role="status" className="text-sm">
          {t('account.profile.resent')}
        </p>
      ) : (
        <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
          {t('account.profile.resend')}
        </Button>
      )}
    </form>
  );
}
