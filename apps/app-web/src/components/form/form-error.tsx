'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import type { ApiError } from '@/lib/api/errors';
import { errorMessageKey, type LooseT } from './errors';

/**
 * A form's error, in the reader's language, announced as it appears (`role="alert"`). The
 * reference is shown for the failures a person would take to support — never for a wrong
 * password, where it would only add noise.
 */
export function FormError({
  error,
  overrides,
}: {
  error: ApiError | null;
  overrides?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations() as unknown as LooseT;
  if (error === null) return null;
  const supportable = error.status >= 500 || error.code === 'NETWORK';
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertContent>
        <AlertTitle>{t(errorMessageKey(error, t, overrides))}</AlertTitle>
        {supportable && error.correlationId !== null && (
          <p className="text-sm">{t('error.reference', { ref: error.correlationId })}</p>
        )}
      </AlertContent>
    </Alert>
  );
}
