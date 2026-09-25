'use client';

import { LocateFixed, SearchX, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { EmptyState } from '@/components/empty-state';
import { FormError } from '@/components/form/form-error';
import type { CategoryOption } from '@/lib/taxonomy';
import { coarse } from '@/components/investigator/service-areas';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { callApi } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';
import type { InvestigatorSearchResult, LonLat } from '@/lib/api/types';
import type { CodeOption } from '@/lib/codes';
import {
  discoveryHref,
  narrowingCount,
  RADII,
  searchBody,
  type DiscoveryFilters,
} from './discovery-query';
import { DiscoverySheet, weekday } from './discovery-sheet';
import { InvestigatorCard } from './investigator-card';

type Page = {
  items: InvestigatorSearchResult[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
};
type Locating = 'idle' | 'locating' | 'denied' | 'failed';
type Chip = { key: string; label: string; without: DiscoveryFilters };

const asError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');

/**
 * Finding investigators (T-120): verified investigators taking on work, narrowed by a typed,
 * closed set of filters the address holds, nearest first when the customer shares where they are.
 *
 * Searched from the browser, not rendered on the server, because "near me" is the device's
 * position, which never enters the address (`discovery-query.ts`); it is rounded to about a
 * kilometre on the device, as service areas are, and kept only in this page's memory.
 *
 * No map yet: no map provider is chosen (owner decision, 2026-09-26; T-147).
 */
export function InvestigatorDiscovery({
  filters,
  categories,
  countries,
  languages,
  locale,
}: {
  filters: DiscoveryFilters;
  categories: readonly CategoryOption[];
  countries: readonly CodeOption[];
  languages: readonly CodeOption[];
  locale: string;
}) {
  const t = useTranslations('missions.discovery');
  const tp = useTranslations('investigator.details');
  const [centre, setCentre] = useState<LonLat | null>(null);
  const [radius, setRadius] = useState<number>(0);
  const [locating, setLocating] = useState<Locating>('idle');
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Answers to an earlier search are dropped when a newer one has started.
  const generation = useRef(0);
  const labels = new Map(categories.map((c) => [c.id, c.label]));

  const near = centre === null ? null : { centre, radiusKm: radius };
  const key = JSON.stringify(searchBody(filters, near, null));

  const search = useCallback(
    async (cursor: string | null) => {
      const gen = ++generation.current;
      if (cursor === null) setLoading(true);
      else setMore(true);
      setError(null);
      try {
        const next = (await callApi<Page>('/search/investigators', {
          body: { ...(JSON.parse(key) as object), ...(cursor === null ? {} : { cursor }) },
        }))!;
        if (gen !== generation.current) return;
        setPage((p) =>
          cursor === null || p === null ? next : { ...next, items: [...p.items, ...next.items] },
        );
      } catch (e) {
        if (gen !== generation.current) return;
        setError(asError(e));
      } finally {
        if (gen === generation.current) {
          setLoading(false);
          setMore(false);
        }
      }
    },
    [key],
  );

  useEffect(() => {
    void search(null);
  }, [search]);

  const locate = () => {
    setLocating('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCentre(coarse(position));
        setLocating('idle');
      },
      (err) => setLocating(err.code === err.PERMISSION_DENIED ? 'denied' : 'failed'),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
    );
  };

  const chips: Chip[] = [];
  const without = (key: keyof DiscoveryFilters): DiscoveryFilters => {
    const next = { ...filters };
    delete next[key];
    return next;
  };
  if (filters.taxonomyNodeId !== undefined) {
    chips.push({
      key: 'category',
      label: labels.get(filters.taxonomyNodeId) ?? t('category'),
      without: without('taxonomyNodeId'),
    });
  }
  const languageName = new Map(languages.map((l) => [l.code, l.name]));
  for (const code of filters.languages ?? []) {
    const rest = filters.languages!.filter((l) => l !== code);
    chips.push({
      key: `language-${code}`,
      label: languageName.get(code) ?? code,
      without: rest.length > 0 ? { ...filters, languages: rest } : without('languages'),
    });
  }
  if (filters.countryCode !== undefined) {
    chips.push({
      key: 'country',
      label: countries.find((c) => c.code === filters.countryCode)?.name ?? filters.countryCode,
      without: without('countryCode'),
    });
  }
  if (filters.city !== undefined) {
    chips.push({ key: 'city', label: filters.city, without: without('city') });
  }
  if (filters.day !== undefined) {
    chips.push({
      key: 'day',
      label: t('chip_day', { day: weekday(filters.day, locale) }),
      without: without('day'),
    });
  }
  if (filters.pricingModel !== undefined) {
    chips.push({
      key: 'pricing',
      label: tp(`pricing_${filters.pricingModel}`),
      without: without('pricingModel'),
    });
  }

  const widest = RADII[RADII.length - 1]!;
  const narrowed = narrowingCount(filters) > 0 || (near !== null && radius < widest);

  return (
    <div className="mt-4 grid gap-4">
      <p className="text-sm text-text-muted">{t('intro')}</p>

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <DiscoverySheet
          filters={filters}
          categories={categories}
          countries={countries}
          languages={languages}
          locale={locale}
        />
        {centre === null ? (
          <Button
            variant="outline"
            onClick={locate}
            disabled={locating === 'locating'}
            aria-busy={locating === 'locating'}
          >
            <LocateFixed aria-hidden />
            {locating === 'locating' ? t('locating') : t('near')}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setCentre(null);
              setRadius(0);
            }}
          >
            <X aria-hidden />
            {t('near_off')}
          </Button>
        )}
      </div>

      {(locating === 'denied' || locating === 'failed') && (
        <p role="alert" className="text-sm text-danger">
          {locating === 'denied' ? t('denied') : t('failed')}
        </p>
      )}

      {centre !== null && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{t('radius')}</legend>
          <ToggleGroup
            type="single"
            value={String(radius)}
            onValueChange={(v) => {
              if (v !== '') setRadius(Number(v));
            }}
            aria-label={t('radius')}
          >
            {RADII.map((km) => (
              <ToggleGroupItem key={km} value={String(km)}>
                {km === 0 ? t('radius_covers') : t('radius_km', { km })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-sm text-text-muted">{t('near_on')}</p>
        </fieldset>
      )}

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <Link
                href={discoveryHref(c.without)}
                aria-label={t('remove', { filter: c.label })}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-control bg-primary-subtle px-4 text-sm font-medium text-primary hover:bg-surface-sunken"
              >
                {c.label}
                <X aria-hidden className="size-4" />
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={discoveryHref({})}
              className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-text-muted hover:underline"
            >
              {t('clear')}
            </Link>
          </li>
        </ul>
      )}

      <FormError error={error} />

      {loading ? (
        <div role="status" aria-label={t('loading')} className="grid gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : page === null ? null : page.items.length === 0 ? (
        <>
          <EmptyState
            icon={narrowed ? SearchX : Users}
            title={narrowed ? t('empty_title') : t('none_title')}
            body={narrowed ? t('empty_body') : t('none_body')}
          />
          {near !== null && radius < widest && (
            <Button variant="outline" onClick={() => setRadius(widest)}>
              {t('further', { km: widest })}
            </Button>
          )}
        </>
      ) : (
        <>
          <ul className="grid gap-4">
            {page.items.map((r) => (
              <li key={r.id}>
                <InvestigatorCard result={r} categories={labels} />
              </li>
            ))}
          </ul>
          {page.pageInfo.hasNextPage && (
            <Button
              variant="outline"
              disabled={more}
              aria-busy={more}
              onClick={() => void search(page.pageInfo.nextCursor)}
            >
              {t('more')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
