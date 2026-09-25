'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { useSubmit } from '@/components/form/use-submit';
import { LegalDocuments } from '@/components/legal-documents';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { AgencyView, LegalDocument } from '@/lib/api/types';
import type { CodeOption } from '@/lib/codes';
import { navigate } from '@/lib/navigate';
import { SWITCHED_KEY } from './workspace-scope';

/** The fields the API may refuse, each shown under its own input. */
type FieldName = 'name' | 'countryCode' | 'businessEmail' | 'timezone' | 'currency';

/**
 * Creating an agency (T-092, on T-083's API): the five details that make it usable and the agency
 * terms, on one screen — then the new agency is the workspace, and the app opens in it. Every field
 * is required here, although the API accepts fewer: an agency missing one would be created
 * unusable, and nothing yet lets its details be completed afterwards.
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
  const message = (field: FieldName) => fields[field] && tl(fields[field]);

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4">
      <FormError error={error} />
      <Field
        label={t('name')}
        name="name"
        required
        minLength={2}
        maxLength={120}
        autoComplete="organization"
        error={message('name')}
      />
      <SelectField
        label={t('country')}
        hint={t('country_hint')}
        error={message('countryCode')}
        name="countryCode"
        required
        defaultValue=""
      >
        <option value="" disabled>
          {t('choose')}
        </option>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <Field
        label={t('email')}
        hint={t('email_hint')}
        name="businessEmail"
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        error={message('businessEmail')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t('timezone')}
          error={message('timezone')}
          name="timezone"
          required
          defaultValue={timezone}
        >
          {timezones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('currency')}
          error={message('currency')}
          name="currency"
          required
          defaultValue=""
        >
          <option value="" disabled>
            {t('choose')}
          </option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
      </div>
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
