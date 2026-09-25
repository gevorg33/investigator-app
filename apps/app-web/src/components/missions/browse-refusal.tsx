'use client';

import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { FormError } from '@/components/form/form-error';
import { ApiError, type FieldIssue } from '@/lib/api/errors';

/**
 * Why a browse was refused, field by field — "choose a currency for a budget" rather than only
 * "some details need correcting". The error crosses from the server as plain data.
 */
export function BrowseRefusal({
  status,
  code,
  messageKey,
  details,
}: {
  status: number;
  code: string;
  messageKey: string;
  details: readonly FieldIssue[];
}) {
  const t = useTranslations() as unknown as LooseT;
  const error = new ApiError(status, code, messageKey, details);
  const fields = Object.values(fieldErrorKeys(error, t));
  return (
    <div className="mt-6 grid gap-2">
      <FormError error={error} />
      {fields.length > 0 && (
        <ul className="grid gap-1 text-sm text-danger">
          {fields.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
