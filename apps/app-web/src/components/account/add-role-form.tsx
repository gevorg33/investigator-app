'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { LegalDocuments } from '@/components/legal-documents';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { LegalDocument } from '@/lib/api/types';

/**
 * Adding the other role (T-127). This is the action outstanding acceptance blocks, and only it:
 * what the role binds its holder to is shown and accepted here, with the ids posted back
 * (T-022). Nothing is published yet? Then there is nothing to accept, and the role is added.
 */
export function AddRoleForm({
  role,
  label,
  documents,
}: {
  role: 'CUSTOMER' | 'INVESTIGATOR';
  label: string;
  documents: readonly LegalDocument[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    (form) =>
      callApi('/profiles/roles', {
        body: { role, acceptedDocumentIds: form.getAll('acceptedDocumentIds') },
      }),
    () => router.refresh(),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      {/* Names each document the API says is missing, under its title (T-135). */}
      <FormError error={error} />
      <LegalDocuments
        documents={documents}
        intro={t('account.roles.accept_first')}
        accept={t('account.roles.accept')}
      />
      <Button
        type="submit"
        variant={documents.length > 0 ? 'default' : 'outline'}
        disabled={pending}
        aria-busy={pending}
      >
        {documents.length > 0 ? `${label} — ${t('account.roles.add_submit')}` : label}
      </Button>
    </form>
  );
}
