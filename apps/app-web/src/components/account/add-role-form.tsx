'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
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
  const tl = t as unknown as LooseT;
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    (form) =>
      callApi('/profiles/roles', {
        body: { role, acceptedDocumentIds: form.getAll('acceptedDocumentIds') },
      }),
    () => router.refresh(),
  );
  const refused = Object.values(fieldErrorKeys(error, tl));
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <FormError error={error} />
      {refused.length > 0 && (
        <ul className="grid gap-1 text-sm text-danger">
          {refused.map((key) => (
            <li key={key}>{tl(key)}</li>
          ))}
        </ul>
      )}
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
