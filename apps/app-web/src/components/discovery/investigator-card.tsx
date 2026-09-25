'use client';

import { formatBudget, type Locale } from '@investigator/i18n';
import { BadgeCheck, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'use-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { InvestigatorSearchResult } from '@/lib/api/types';
import { DISCOVERY_PATH } from './discovery-query';

/**
 * One investigator a search found (T-120), as an `article` named by their name: verified, how far,
 * their line; why they are listed — only from what the search matched on, never a reason the API
 * did not give (`discovery.md`) — and, when some specialties asked for are not theirs, that too;
 * then languages, experience and how they charge. Matches (T-107) will reuse it.
 */
export function InvestigatorCard({
  result,
  categories,
}: {
  result: InvestigatorSearchResult;
  categories: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('missions.discovery.card');
  const ti = useTranslations('investigator');
  const locale = useLocale() as Locale;
  const languages = new Intl.DisplayNames([locale], { type: 'language' });
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const list = (items: string[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
  const label = (id: string) => categories.get(id);
  const name = result.displayName ?? ti('details.not_set');
  const id = `investigator-${result.id}`;

  const { matchedOn, notMatched } = result;
  const matched = [
    ...matchedOn.taxonomyNodeIds.map(label).filter((l): l is string => l !== undefined),
    ...matchedOn.languages.map((code) => languages.of(code)!),
    ...(matchedOn.place?.city !== undefined ? [matchedOn.place.city] : []),
    ...(matchedOn.place?.countryCode !== undefined
      ? [regions.of(matchedOn.place.countryCode)!]
      : []),
    ...(matchedOn.availability ? [t('available')] : []),
  ];
  const missing = notMatched.taxonomyNodeIds.map(label).filter((l): l is string => l !== undefined);
  const rate =
    result.hourlyRateMinor !== null && result.currency !== null
      ? formatBudget(result.hourlyRateMinor, result.currency, locale)
      : null;

  return (
    <article aria-labelledby={id}>
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {result.verified && (
              <Badge variant="secondary">
                <BadgeCheck aria-hidden />
                {t('verified')}
              </Badge>
            )}
            {result.distanceKm !== null && (
              <span className="inline-flex items-center gap-1 text-sm text-text-muted">
                <MapPin aria-hidden className="size-4" />
                {result.distanceKm === 0 ? t('covers') : t('distance', { km: result.distanceKm })}
              </span>
            )}
          </div>
          <CardTitle id={id}>
            <Link href={`${DISCOVERY_PATH}/${result.id}`} className="hover:underline">
              {name}
            </Link>
          </CardTitle>
          {result.headline !== null && <p className="text-text-muted">{result.headline}</p>}
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {matched.length > 0 && (
            <p className="text-success">{t('matched', { items: list(matched) })}</p>
          )}
          {missing.length > 0 && <p>{t('missing', { items: list(missing) })}</p>}
          <p className="text-text-muted">
            {[
              ...result.languages.map((l) => languages.of(l.languageCode)!),
              ...(result.yearsExperience !== null
                ? [ti('details.years_count', { count: result.yearsExperience })]
                : []),
              ...(result.pricingModel !== null
                ? [
                    rate !== null
                      ? `${ti(`details.pricing_${result.pricingModel}`)}, ${ti('details.rate_value', { rate })}`
                      : ti(`details.pricing_${result.pricingModel}`),
                  ]
                : []),
            ].join(' · ')}
          </p>
        </CardContent>
        <CardFooter>
          <Link
            href={`${DISCOVERY_PATH}/${result.id}`}
            aria-label={`${t('view')}: ${name}`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          >
            {t('view')}
          </Link>
        </CardFooter>
      </Card>
    </article>
  );
}
