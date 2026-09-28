'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { LegalDocuments } from '@/components/legal-documents';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { callApi } from '@/lib/api/browser';
import type { LegalDocument } from '@/lib/api/types';
import { deviceTimeZone, navigate } from '@/lib/navigate';

type Pending = { state: 'loading' } | { state: 'ready'; email: string } | { state: 'gone' };

/**
 * The last step of a first sign-in with Google (T-062): the address Google confirmed, the documents
 * registration requires — accepted here, as at any sign-up (T-022) — and the account is created. The
 * sign-up itself is an httpOnly cookie the API set on the way back from Google, so the address is
 * asked of the API from this browser, and a sign-up that has lapsed or was used says so.
 */
export function GoogleSignupForm({
  documents,
  next = '/',
}: {
  documents: readonly LegalDocument[];
  next?: string;
}) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [pending, setPending] = useState<Pending>({ state: 'loading' });

  useEffect(() => {
    callApi<{ email: string }>('/auth/google/pending', { method: 'GET' })
      .then((found) => setPending({ state: 'ready', email: found!.email }))
      .catch(() => setPending({ state: 'gone' }));
  }, []);

  const submit = useSubmit(
    (form) =>
      callApi('/auth/google/complete', {
        body: {
          acceptedDocumentIds: form.getAll('acceptedDocumentIds'),
          locale,
          timezone: deviceTimeZone(),
        },
      }),
    () => navigate(`/session/start?next=${encodeURIComponent(next)}`),
  );
  // Spent or lapsed while the page was open: the same as arriving too late.
  const spent = submit.error?.code === 'STATE_CONFLICT';

  if (pending.state === 'loading') {
    return <Skeleton className="h-24 w-full" aria-hidden />;
  }
  if (pending.state === 'gone' || spent) {
    return (
      <div className="grid gap-4">
        <Alert>
          <AlertContent>
            <AlertTitle>{t('google.signup_expired')}</AlertTitle>
          </AlertContent>
        </Alert>
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('google.start_again')}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit.onSubmit} className="grid gap-4">
      <p className="text-sm">{t('google.signup_intro', { email: pending.email })}</p>
      <FormError error={submit.error} />
      <LegalDocuments
        documents={documents}
        intro={t('sign_up.accept_intro')}
        accept={t('sign_up.accept')}
      />
      <Button type="submit" disabled={submit.pending} aria-busy={submit.pending}>
        {t('sign_up.submit')}
      </Button>
    </form>
  );
}
