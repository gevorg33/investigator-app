'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { LegalDocuments } from '@/components/legal-documents';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { AgencyView, LegalDocument } from '@/lib/api/types';
import type { CodeOption } from '@/lib/codes';
import { navigate } from '@/lib/navigate';
import { AGENCY_DETAILS, type AgencyDetail } from './agency-details';
import { AgencyDetailsFields } from './agency-details-fields';
import { SWITCHED_KEY } from './workspace-scope';

/**
 * Creating an agency (T-092, on T-083's API): the five details that make it usable and the agency
 * terms, on one screen — then the new agency is the workspace, and the app opens in it. Every field
 * is required here, although the API accepts fewer: asking for all five now is one screen, where
 * leaving one out means a second visit to Agency details (T-150) before the agency can be used.
 *
 * One idempotency key for the life of the form, so a retry after a dropped response returns the
 * agency already created rather than a second one.
 */
export function CreateAgencyForm({
  agreement,
  countries,
  currencies,
  timezones,
  timezone,
}: {
  agreement: LegalDocument;
  countries: readonly CodeOption[];
  currencies: readonly string[];
  timezones: readonly string[];
  /** The creator's own time zone, offered first. */
  timezone: string;
}) {
  const t = useTranslations('workspace.create_agency');
  const tl = useTranslations() as unknown as LooseT;
  const [key] = useState(() => crypto.randomUUID());
  const { pending, error, onSubmit } = useSubmit(
    async (form) => {
      const agency = await callApi<AgencyView>('/agencies', {
        idempotencyKey: key,
        body: {
          name: String(form.get('name')).trim(),
          countryCode: form.get('countryCode'),
          businessEmail: String(form.get('businessEmail')).trim(),
          timezone: form.get('timezone'),
          currency: form.get('currency'),
          agreementDocumentId: agreement.id,
        },
      });
      await callApi(`/workspaces/${encodeURIComponent(agency!.id)}/activate`);
      return agency!;
    },
    (agency) => {
      try {
        sessionStorage.setItem(SWITCHED_KEY, agency.id);
      } catch {
        // Only the confirmation is lost.
      }
      navigate('/');
    },
  );
  const fields = fieldErrorKeys(error, tl);
  const message = (field: AgencyDetail) => fields[field] && tl(fields[field]);

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4">
      <FormError
        error={error}
        shown={[
          'name',
          'countryCode',
          'businessEmail',
          'timezone',
          'currency',
          'agreementDocumentId',
        ]}
      />
      <AgencyDetailsFields
        values={{ timezone }}
        errors={Object.fromEntries(AGENCY_DETAILS.map((f) => [f, message(f)]))}
        countries={countries}
        currencies={currencies}
        timezones={timezones}
      />
      <LegalDocuments documents={[agreement]} intro={t('accept_intro')} accept={t('accept')} />
      {fields['agreementDocumentId'] && (
        <p className="text-sm text-danger">{tl(fields['agreementDocumentId'])}</p>
      )}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
