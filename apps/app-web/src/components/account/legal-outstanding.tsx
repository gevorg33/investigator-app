'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { LegalDocuments } from '@/components/legal-documents';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { LegalDocument } from '@/lib/api/types';

/** Accepting documents a new version put back on the list (T-022, `POST /legal/acceptances`). */
export function LegalOutstandingForm({ documents }: { documents: readonly LegalDocument[] }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    (form) =>
      callApi('/legal/acceptances', {
        body: { acceptedDocumentIds: form.getAll('acceptedDocumentIds') },
      }),
    () => router.refresh(),
  );
  return (
    // One column the form's width (`minmax(0, 1fr)`): the documents' fieldset otherwise widens an
    // implicit `auto` column to its longest line — a translation note in Armenian or Russian — and the
    // page past a phone's edge (T-177).
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3">
      <FormError error={error} />
      <LegalDocuments
        documents={documents}
        intro={t('account.legal.body')}
        accept={t('account.legal.accept')}
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('account.legal.submit')}
      </Button>
    </form>
  );
}
