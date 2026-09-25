'use client';

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
  // FormError lists each refused filter's own message under its title (T-135).
  return (
    <div className="mt-6 grid gap-2">
      <FormError error={new ApiError(status, code, messageKey, details)} />
    </div>
  );
}
