'use client';

import { localeName, formatDateTime, isLocale, type Locale } from '@investigator/i18n';
import { useLocale, useTranslations } from 'use-intl';
import type { LegalDocument } from '@/lib/api/types';

/**
 * Documents a step requires, shown in full before anyone accepts them (legal-consent), with one
 * checkbox for all of them. Each opens in place: the text is part of the form, so nothing is
 * accepted unseen and nothing needs a new tab. Where a document has no translation into the
 * reader's language, the language it is shown in is said — that is the version being accepted,
 * and the id posted back records exactly it.
 */
export function LegalDocuments({
  documents,
  intro,
  accept,
}: {
  documents: readonly LegalDocument[];
  intro: string;
  accept: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  if (documents.length === 0) return null;
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">{intro}</legend>
      <ul className="grid gap-2">
        {documents.map((d) => (
          <li key={d.id}>
            <details className="rounded-md border border-border bg-surface-raised">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
                {d.title}
              </summary>
              <div className="grid gap-2 border-t border-border px-3 py-3">
                <p className="text-xs text-text-muted">
                  {t('legal.version', {
                    version: d.version,
                    date: formatDateTime(d.effectiveFrom, {
                      locale,
                      timeZone: 'UTC',
                      style: 'date',
                    }),
                  })}
                </p>
                {d.locale !== locale && isLocale(d.locale) && (
                  <p className="text-xs text-text-muted">
                    {t('auth.sign_up.shown_in', { language: localeName(d.locale) })}
                  </p>
                )}
                <div className="max-h-64 overflow-y-auto text-sm whitespace-pre-line">
                  {d.content}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="accept" required className="size-5 accent-primary" />
        {accept}
      </label>
      {documents.map((d) => (
        <input key={d.id} type="hidden" name="acceptedDocumentIds" value={d.id} />
      ))}
    </fieldset>
  );
}
