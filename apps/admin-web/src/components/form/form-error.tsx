import { CircleAlert } from 'lucide-react';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { has, t, type MessageKey } from '@/i18n/messages';
import type { ApiError } from '@/lib/api/errors';

/**
 * A form's error, announced as it appears (`role="alert"`), as app-web shows one: a form's own
 * wording for a code where it has one, else the API's `messageKey` where the catalog has it, else
 * a generic one — never the raw key. The reference is shown for failures support can help with.
 */
export function FormError({
  error,
  overrides = {},
}: {
  error: ApiError | null;
  overrides?: Readonly<Partial<Record<string, MessageKey>>>;
}) {
  if (error === null) return null;
  const key =
    overrides[error.code] ?? (has(error.messageKey) ? error.messageKey : 'error.common.internal');
  const supportable = error.status >= 500 || error.code === 'NETWORK';
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertContent>
        <AlertTitle>{t(key)}</AlertTitle>
        {supportable && error.correlationId !== null && (
          <p className="text-sm">{t('error.reference', { ref: error.correlationId })}</p>
        )}
      </AlertContent>
    </Alert>
  );
}
