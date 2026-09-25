'use client';

import type { Locale } from '@investigator/i18n';
import { Check, Minus, ShieldCheck } from 'lucide-react';
import { useId } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InvestigatorMatch, MatchReason } from '@/lib/api/assistant';
import { labels, languageName, list, placeName, windowParts } from './discovery-format';

/**
 * One investigator a search found (T-059), as a card: who they are in their own words (name,
 * headline), that they are verified, and why they are here — **only** from `matchedOn` and
 * `notMatched`, as the search returned them. No sentence on it was written by a model
 * (`investigator-discovery`): each reason is a code phrased here, from the data.
 */
export function InvestigatorCard({ match }: { match: InvestigatorMatch }) {
  const t = useTranslations('assistant.discovery');
  const locale = useLocale() as Locale;
  const title = useId();

  const reason = (r: MatchReason): string => {
    switch (r.code) {
      case 'matched.specialty':
        return t('reason.specialty', { list: list(labels(r.specialties), locale) });
      case 'matched.languages':
        return t('reason.languages', {
          list: list(
            r.languages.map((c) => languageName(c, locale)),
            locale,
          ),
        });
      case 'matched.place':
        return t('reason.place', { place: placeName(r.place, locale) });
      case 'matched.distance':
        return t('reason.distance', { km: r.km });
      case 'matched.availability':
        return t('reason.availability', windowParts(r.window, locale));
      case 'not_matched.specialty':
        return t('reason.not_specialty', { list: list(labels(r.specialties), locale) });
    }
  };

  const specialties = labels(match.specialties);
  return (
    <Card role="article" aria-labelledby={title} className="gap-3">
      <CardHeader className="gap-1">
        <CardTitle id={title}>{match.displayName ?? t('unnamed')}</CardTitle>
        {match.headline !== null && <p className="text-text-muted">{match.headline}</p>}
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">
            <ShieldCheck aria-hidden />
            {t('verified')}
          </Badge>
          {match.yearsExperience !== null && (
            <span className="text-text-muted">{t('years', { years: match.yearsExperience })}</span>
          )}
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {match.explanation.length > 0 && (
          <section aria-label={t('why')}>
            <ul className="grid gap-1">
              {match.explanation.map((r) => {
                const gap = r.code.startsWith('not_matched');
                return (
                  <li key={r.code} className="flex items-start gap-2">
                    {gap ? (
                      <Minus aria-hidden className="mt-1 size-4 shrink-0 text-warning" />
                    ) : (
                      <Check aria-hidden className="mt-1 size-4 shrink-0 text-success" />
                    )}
                    <span>{reason(r)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <dl className="grid gap-1 text-sm">
          {match.languages.length > 0 && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-text-muted">{t('languages')}</dt>
              <dd>
                {list(
                  match.languages.map((l) => languageName(l.code, locale)),
                  locale,
                )}
              </dd>
            </div>
          )}
          {specialties.length > 0 && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-text-muted">{t('specialties')}</dt>
              <dd>{list(specialties, locale)}</dd>
            </div>
          )}
          {match.availability.length > 0 && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-text-muted">{t('hours')}</dt>
              <dd>
                {list(
                  match.availability.map((w) => {
                    const { day, from, to } = windowParts(w, locale);
                    return `${day} ${from}–${to}`;
                  }),
                  locale,
                )}
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
