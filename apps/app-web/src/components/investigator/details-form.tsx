'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { toMinorAmount, toWhole } from '@/components/missions/browse-query';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupChoice } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { callApi } from '@/lib/api/browser';
import type { OwnInvestigatorProfile, PricingModel, PublicName } from '@/lib/api/types';

const PRICING: readonly PricingModel[] = ['HOURLY', 'FIXED_FEE', 'RETAINER', 'MIXED'];
const PUBLIC_NAMES: readonly PublicName[] = ['PSEUDONYM', 'LEGAL'];

/** The text fields of a patch: blank means "not set", sent as nothing rather than as "". */
const text = (form: FormData, name: string) => {
  const v = String(form.get(name)).trim();
  return v === '' ? undefined : v;
};

/**
 * What the investigator says about themselves (T-123). Saved together; the contact phone is theirs
 * alone — it is not in the public projection, and the form says so where it is asked for. The legal
 * name is too, unless they choose to be known by it: customers see a pseudonym by default (T-181),
 * and the investigator picks which of the two goes on their profile (T-182).
 */
export function DetailsForm({
  profile,
  currencies,
}: {
  profile: OwnInvestigatorProfile;
  /** From the server's `Intl`, so the list the browser hydrates is the list the server rendered. */
  currencies: readonly string[];
}) {
  const t = useTranslations('investigator.details');
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [currency, setCurrency] = useState(profile.currency ?? '');
  const [publicName, setPublicName] = useState(profile.publicName);
  const publicNameLabel = useId();
  // Verification checked the documents against this name (owner decision, 2026-09-25).
  const nameLocked =
    profile.verificationStatus === 'VERIFIED' || profile.verificationStatus === 'PENDING';
  const { pending, error, onSubmit } = useSubmit(
    (form) => {
      setSaved(false);
      const years = text(form, 'years');
      const rate = toMinorAmount(text(form, 'rate'), currency || undefined);
      const pricing = text(form, 'pricing') as PricingModel | undefined;
      const name = text(form, 'name');
      return callApi('/profiles/investigator/me', {
        method: 'PATCH',
        body: {
          // A locked name is not sent at all: it is shown, not edited.
          ...(!nameLocked && name !== undefined ? { displayName: name } : {}),
          publicName,
          // Blank clears it, and customers see the stand-in code again (T-181). Not asked for while
          // the legal name is chosen, so not sent: it is kept for the day they switch back (T-182).
          ...(publicName === 'PSEUDONYM' ? { pseudonym: text(form, 'pseudonym') ?? null } : {}),
          headline: text(form, 'headline') ?? '',
          bio: text(form, 'bio') ?? '',
          contactPhone: text(form, 'phone') ?? '',
          ...(years !== undefined ? { yearsExperience: Number(years) } : {}),
          ...(pricing !== undefined ? { pricingModel: pricing } : {}),
          ...(rate !== undefined ? { hourlyRateMinor: rate } : {}),
          ...(currency !== '' ? { currency } : {}),
        },
      });
    },
    () => {
      setSaved(true);
      router.refresh();
    },
  );

  const tl = useTranslations() as unknown as LooseT;
  const fields = fieldErrorKeys(error, tl);

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError error={error} shown={['displayName', 'pseudonym']} />
      <Field
        label={t('name')}
        hint={nameLocked ? t('name_locked') : t('name_hint')}
        name="name"
        autoComplete="name"
        maxLength={80}
        required={!nameLocked}
        readOnly={nameLocked}
        defaultValue={profile.displayName ?? ''}
        error={fields['displayName'] && tl(fields['displayName'])}
      />
      {/* Which name customers see: a pseudonym unless they choose the legal one above (T-182). */}
      <div className="grid gap-2">
        <p id={publicNameLabel} className="text-sm font-medium">
          {t('public_name')}
        </p>
        <RadioGroup
          aria-labelledby={publicNameLabel}
          value={publicName}
          onValueChange={(v) => setPublicName(v as PublicName)}
        >
          {PUBLIC_NAMES.map((choice) => (
            <RadioGroupChoice key={choice} value={choice} label={t(`public_name_${choice}`)} />
          ))}
        </RadioGroup>
      </div>
      {publicName === 'PSEUDONYM' && (
        <Field
          label={t('pseudonym')}
          hint={t('pseudonym_hint')}
          name="pseudonym"
          autoComplete="off"
          maxLength={60}
          defaultValue={profile.pseudonym ?? ''}
          error={fields['pseudonym'] && tl(fields['pseudonym'])}
        />
      )}
      <Field
        label={t('headline')}
        hint={t('headline_hint')}
        name="headline"
        maxLength={120}
        defaultValue={profile.headline ?? ''}
      />
      <label className="grid gap-1.5 text-sm font-medium">
        {t('bio')}
        <Textarea name="bio" maxLength={4000} rows={5} defaultValue={profile.bio ?? ''} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('years')}
          name="years"
          type="number"
          inputMode="numeric"
          min={0}
          max={80}
          defaultValue={profile.yearsExperience ?? ''}
        />
        <label className="grid gap-1.5 text-sm font-medium">
          {t('pricing')}
          <NativeSelect name="pricing" defaultValue={profile.pricingModel ?? ''}>
            <option value="">{t('not_set')}</option>
            {PRICING.map((p) => (
              <option key={p} value={p}>
                {t(`pricing_${p}`)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {t('currency')}
          <NativeSelect value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">{t('not_set')}</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Field
          label={t('rate')}
          name="rate"
          inputMode="decimal"
          defaultValue={
            profile.hourlyRateMinor === null
              ? ''
              : toWhole(profile.hourlyRateMinor, profile.currency ?? undefined)
          }
        />
      </div>
      <Field
        label={t('phone')}
        hint={t('phone_hint')}
        name="phone"
        type="tel"
        autoComplete="tel"
        maxLength={32}
        defaultValue={profile.contactPhone ?? ''}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('save')}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-success">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  );
}
