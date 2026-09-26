'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import type { ApiError } from '@/lib/api/errors';
import { errorMessageKey, fieldErrorKeys, type LooseT } from './errors';

/**
 * A form's error, in the reader's language, announced as it appears (`role="alert"`). The
 * reference is shown for the failures a person would take to support — never for a wrong
 * password, where it would only add noise.
 *
 * A refused field's own message is listed under the title (T-135): "You can have up to 10
 * service areas", not only "Some details need correcting". A form that shows a field's message
 * beside the field itself names it in `shown`, or passes `'all'`, so nothing is said twice.
 */
export function FormError({
  error,
  overrides,
  shown = [],
}: {
  error: ApiError | null;
  overrides?: Readonly<Record<string, string>>;
  /** The fields whose messages this form already shows beside them — or all of them. */
  shown?: readonly string[] | 'all';
}) {
  const t = useTranslations() as unknown as LooseT;
  if (error === null) return null;
  const supportable = error.status >= 500 || error.code === 'NETWORK';
  const details =
    shown === 'all'
      ? []
      : [
          ...new Set(
            Object.entries(fieldErrorKeys(error, t))
              .filter(([field]) => !shown.includes(field))
              .map(([, key]) => t(key)),
          ),
        ];
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertContent>
        <AlertTitle>{t(errorMessageKey(error, t, overrides))}</AlertTitle>
        {details.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {supportable && error.correlationId !== null && (
          <p className="text-sm">{t('error.reference', { ref: error.correlationId })}</p>
        )}
      </AlertContent>
    </Alert>
  );
}
