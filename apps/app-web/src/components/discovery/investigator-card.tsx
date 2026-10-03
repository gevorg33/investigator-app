'use client';

import { formatBudget, type Locale } from '@investigator/i18n';
import { BadgeCheck, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'use-intl';
import { investigatorName } from '@/lib/investigator-name';
import { AgencyLine } from '@/components/investigator/agency-line';
import { namedList } from '@/components/named-text';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { InvestigatorSearchResult } from '@/lib/api/types';
import type { Named } from '@/lib/taxonomy';
import { DISCOVERY_PATH } from './discovery-query';

/**
 * One investigator a search found (T-120), as an `article` named by their name: verified, how far,
 * the agency they work for (T-185), their line; why they are listed — only from what the search matched on, never a reason the API
 * did not give (`discovery.md`) — and, when some specialties asked for are not theirs, that too;
 * then languages, experience and how they charge. Matches (T-107) will reuse it.
 */
export function InvestigatorCard({
  result,
  categories,
}: {
  result: InvestigatorSearchResult;
  categories: ReadonlyMap<string, Named>;
}) {
  const t = useTranslations('missions.discovery.card');
  const ti = useTranslations('investigator');
  const locale = useLocale() as Locale;
  const languages = new Intl.DisplayNames([locale], { type: 'language' });
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const label = (id: string) => categories.get(id);
  const page = (label: string): Named => ({ label });
  const name = investigatorName(result, (code) => ti('public_name.unnamed', { code }));
  const id = `investigator-${result.id}`;

  const { matchedOn, notMatched } = result;
  // Specialties keep the language the API gave them in; the rest is the page's own.
  const matched: Named[] = [
    ...matchedOn.taxonomyNodeIds.map(label).filter((l) => l !== undefined),
    ...matchedOn.languages.map((code) => page(languages.of(code)!)),
    ...(matchedOn.place?.city !== undefined ? [page(matchedOn.place.city)] : []),
    ...(matchedOn.place?.countryCode !== undefined
      ? [page(regions.of(matchedOn.place.countryCode)!)]
      : []),
    ...(matchedOn.availability ? [page(t('available'))] : []),
  ];
  const missing = notMatched.taxonomyNodeIds.map(label).filter((l) => l !== undefined);
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
          <AgencyLine agency={result.agency} />
          {result.headline !== null && <p className="text-text-muted">{result.headline}</p>}
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {matched.length > 0 && (
            <p className="text-success">
              {t.rich('matched', { items: () => namedList(matched, locale) })}
            </p>
          )}
          {missing.length > 0 && (
            <p>{t.rich('missing', { items: () => namedList(missing, locale) })}</p>
          )}
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
