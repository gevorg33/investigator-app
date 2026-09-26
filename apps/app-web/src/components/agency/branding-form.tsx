'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { BrandingSection } from '@/lib/api/types';

/** A colour as the API takes it: `#` and six hex digits, lower case (branding.ts). */
const HEX = /^#[0-9a-f]{6}$/;

/** What the field holds, as the API takes it: blank is the platform's own, anything else as typed. */
const toValue = (typed: string): string | null =>
  typed.trim() === '' ? null : typed.trim().toLowerCase();

/**
 * The agency's colours (T-094): an accent and a report header, each a colour or the platform's
 * own — the default, and what "nothing configured" means. Whether a colour is readable is the API's
 * rule (contrast against the light theme); a refused one is said beside its field.
 *
 * The sample is drawn on a light surface in every theme (`data-theme="light"`): the colours are
 * measured against the light theme, and a branded fill is never put on the dark theme's chrome.
 * It shows what is saved, with the text colour the API chose for each fill.
 */
export function BrandingForm({ initial }: { initial: BrandingSection }) {
  const t = useTranslations('agency.branding');
  const tl = useTranslations() as unknown as LooseT;
  const router = useRouter();
  const sampleId = useId();
  const [section, setSection] = useState(initial);
  const [accent, setAccent] = useState(initial.values.accentColor ?? '');
  const [header, setHeader] = useState(initial.values.reportHeaderColor ?? '');
  const [saved, setSaved] = useState(false);
  const { pending, error, onSubmit } = useSubmit(
    () =>
      callApi<BrandingSection>('/agencies/current/settings/branding', {
        method: 'PATCH',
        body: {
          version: section.version,
          values: { accentColor: toValue(accent), reportHeaderColor: toValue(header) },
        },
      }),
    (next) => {
      setSection(next!);
      setAccent(next!.values.accentColor ?? '');
      setHeader(next!.values.reportHeaderColor ?? '');
      setSaved(true);
      router.refresh();
    },
  );
  const fields = fieldErrorKeys(error, tl);
  const dirty =
    toValue(accent) !== section.values.accentColor ||
    toValue(header) !== section.values.reportHeaderColor;
  const now = (value: string | null) =>
    value === null ? t('platform') : t('custom', { colour: value });

  const colour = (
    key: 'accentColor' | 'reportHeaderColor',
    typed: string,
    setTyped: (v: string) => void,
    label: string,
    hint: string,
  ) => {
    const candidate = toValue(typed);
    return (
      <div className="grid gap-1.5">
        <Field
          label={label}
          hint={`${hint} ${now(section.values[key])}`}
          name={key}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => {
            setSaved(false);
            setTyped(e.target.value);
          }}
          error={fields[`values.${key}`] && tl(fields[`values.${key}`]!)}
        />
        {candidate !== null && HEX.test(candidate) && (
          <div
            data-theme="light"
            className="flex items-center gap-2 rounded-md bg-surface-raised p-2"
          >
            <span
              aria-hidden
              className="size-8 shrink-0 rounded-sm border border-border"
              style={{ backgroundColor: candidate }}
            />
            <span className="text-sm text-text">{candidate}</span>
          </div>
        )}
      </div>
    );
  };

  const { accentColor, reportHeaderColor } = section.values;
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError error={error} shown={['values.accentColor', 'values.reportHeaderColor']} />
      {saved && (
        <p role="status" className="text-sm">
          {t('saved')}
        </p>
      )}
      {colour('accentColor', accent, setAccent, t('accent'), t('accent_hint'))}
      {colour('reportHeaderColor', header, setHeader, t('report_header'), t('report_header_hint'))}
      <Button
        type="submit"
        className="sm:justify-self-start"
        disabled={pending || !dirty}
        aria-busy={pending}
      >
        {t('save')}
      </Button>

      <figure aria-labelledby={sampleId} className="grid gap-2">
        <figcaption id={sampleId} className="text-sm font-medium">
          {t('sample')}
        </figcaption>
        <div
          data-theme="light"
          className="grid gap-3 rounded-md border border-border bg-surface-raised p-4 text-text"
        >
          <p
            className={
              reportHeaderColor === null
                ? 'rounded-sm bg-primary px-4 py-3 font-semibold text-primary-contrast'
                : 'rounded-sm px-4 py-3 font-semibold'
            }
            style={
              reportHeaderColor === null
                ? undefined
                : {
                    backgroundColor: reportHeaderColor,
                    // The API derives a text colour for every fill it stores.
                    color: section.derived.reportHeaderText!,
                  }
            }
          >
            {t('sample_report')}
          </p>
          <p>
            <span
              className={
                accentColor === null
                  ? 'inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-contrast'
                  : 'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium'
              }
              style={
                accentColor === null
                  ? undefined
                  : { backgroundColor: accentColor, color: section.derived.accentText! }
              }
            >
              {t('sample_accent')}
            </span>
          </p>
        </div>
      </figure>
    </form>
  );
}
