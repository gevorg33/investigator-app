'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { forgetQuery } from '@/lib/navigate';

/**
 * Redeeming an email-verification link. It takes a press of a button, not the page load: mail
 * scanners open links to check them, and one that redeemed on load would spend the token before
 * its owner ever saw it. The token leaves the address bar as soon as the page opens.
 */
export function VerifyEmail({ token }: { token: string }) {
  const t = useTranslations();
  const [done, setDone] = useState(false);
  useEffect(forgetQuery, []);
  const { pending, error, onSubmit } = useSubmit(
    () => callApi('/auth/verify-email', { body: { token } }),
    () => setDone(true),
  );
  if (done) {
    return (
      <div className="grid gap-4">
        <Alert>
          <AlertContent>
            <AlertTitle>{t('auth.verify.done')}</AlertTitle>
          </AlertContent>
        </Alert>
        <Button asChild>
          <Link href="/sign-in?verified=1">{t('auth.verify.continue')}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="text-text-muted">{t('auth.verify.body')}</p>
      <FormError error={error} overrides={{ UNAUTHENTICATED: 'auth.verify.invalid' }} />
      {error?.code === 'UNAUTHENTICATED' && (
        <Link
          href="/check-email"
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('auth.verify.request_new')}
        </Link>
      )}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('auth.verify.submit')}
      </Button>
    </form>
  );
}
