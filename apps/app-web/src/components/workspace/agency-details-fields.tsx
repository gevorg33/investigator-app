'use client';

import { useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
import { SelectField } from '@/components/form/select-field';
import type { CodeOption } from '@/lib/codes';
import type { AgencyDetail } from './agency-details';

export interface AgencyDetailOptions {
  countries: readonly CodeOption[];
  currencies: readonly string[];
  timezones: readonly string[];
}

/**
 * The five inputs, as creating an agency (T-092) and completing or changing one (T-150) both ask
 * for them: the same labels, hints, limits and lists, each with its own error beneath it.
 */
export function AgencyDetailsFields({
  values,
  errors,
  countries,
  currencies,
  timezones,
}: AgencyDetailOptions & {
  values: Readonly<Partial<Record<AgencyDetail, string | null>>>;
  errors: Readonly<Partial<Record<AgencyDetail, string | undefined>>>;
}) {
  const t = useTranslations('workspace.create_agency');
  return (
    <>
      <Field
        label={t('name')}
        name="name"
        required
        minLength={2}
        maxLength={120}
        autoComplete="organization"
        defaultValue={values.name ?? ''}
        error={errors.name}
      />
      <SelectField
        label={t('country')}
        hint={t('country_hint')}
        error={errors.countryCode}
        name="countryCode"
        required
        defaultValue={values.countryCode ?? ''}
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
        defaultValue={values.businessEmail ?? ''}
        error={errors.businessEmail}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t('timezone')}
          error={errors.timezone}
          name="timezone"
          required
          // There is always a zone: the creator's own until the agency names another.
          defaultValue={values.timezone ?? undefined}
        >
          {timezones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('currency')}
          error={errors.currency}
          name="currency"
          required
          defaultValue={values.currency ?? ''}
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
    </>
  );
}
