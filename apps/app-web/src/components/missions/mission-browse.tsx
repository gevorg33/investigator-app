import type { Locale } from '@investigator/i18n';
import { BriefcaseBusiness, SearchX, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import { flattenTaxonomy } from '@/lib/taxonomy';
import type {
  MissionBrowsePage,
  OwnInvestigatorProfile,
  OwnServiceArea,
  SavedMissionSearch,
  TaxonomyNode,
} from '@/lib/api/types';
import { ActiveFilters } from './active-filters';
import { browseHref, narrowingCount, parseBrowse, type SearchParams } from './browse-query';
import { BrowseRefusal } from './browse-refusal';
import { BrowseToolbar } from './browse-toolbar';
import { MissionCard } from './mission-card';
import { SavedSearchList, SaveSearch } from './saved-searches';

/**
 * Open missions for an investigator (T-054): the published missions they could quote on.
 *
 * Search and the controls on top, then the filters that are on, as chips; saved searches; the
 * list; and "more". Who may see the list is the API's decision — the same gate as quoting. Refused,
 * this says what opens it rather than showing an empty list that looks like there is no work.
 */
export async function MissionBrowse({ params, locale }: { params: SearchParams; locale: Locale }) {
  const t = await getT();
  const { filters, cursor } = parseBrowse(params);

  let page: MissionBrowsePage | null = null;
  let refused: ApiError | null = null;
  try {
    page = await serverApi<MissionBrowsePage>('/search/missions', {
      method: 'POST',
      body: { ...filters, ...(cursor === undefined ? {} : { cursor }) },
    });
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 403 && e.status !== 422)) throw e;
    refused = e;
  }

  if (refused?.status === 403) {
    return (
      <>
        <EmptyState
          icon={ShieldCheck}
          title={t('missions.browse.unavailable.title')}
          body={t('missions.browse.unavailable.body')}
        />
        {/* What opens browsing is all on one page: say where. */}
        <Button asChild className="mt-4 w-full sm:w-auto">
          <Link href="/account/investigator">{t('investigator.link')}</Link>
        </Button>
      </>
    );
  }

  const [taxonomy, areas, profile, saved] = await Promise.all([
    serverApi<TaxonomyNode[]>(`/taxonomy?locale=${locale}`),
    serverApi<OwnServiceArea[]>('/service-areas/me'),
    serverApi<OwnInvestigatorProfile>('/profiles/investigator/me'),
    serverApi<{ items: SavedMissionSearch[] }>('/search/missions/saved'),
  ]);
  const categories = flattenTaxonomy(taxonomy ?? []);
  const labels = new Map(categories.map((c) => [c.id, c.label]));
  const items = page?.items ?? [];
  const narrowed = narrowingCount(filters) > 0;
  const now = new Date();

  return (
    <section aria-labelledby="browse-title">
      <h2 id="browse-title" className="sr-only">
        {t('missions.browse.title')}
      </h2>
      <p className="mt-1 text-sm text-text-muted">{t('missions.browse.intro')}</p>

      <BrowseToolbar
        filters={filters}
        categories={categories}
        areas={areas ?? []}
        languages={(profile?.languages ?? []).map((l) => l.languageCode)}
      />

      <ActiveFilters filters={filters} categories={labels} areas={areas ?? []} locale={locale} />

      {(narrowed || filters.q !== undefined) && refused === null && (
        <SaveSearch current={filters} />
      )}

      <SavedSearchList saved={saved?.items ?? []} />

      {refused !== null && (
        <BrowseRefusal
          status={refused.status}
          code={refused.code}
          messageKey={refused.messageKey}
          details={refused.details}
        />
      )}

      {refused === null && items.length === 0 && (
        <EmptyState
          icon={narrowed || filters.q !== undefined ? SearchX : BriefcaseBusiness}
          title={narrowed ? t('missions.browse.empty.title') : t('missions.browse.none.title')}
          body={narrowed ? t('missions.browse.empty.body') : t('missions.browse.none.body')}
        />
      )}

      {items.length > 0 && (
        <ul className="mt-6 grid gap-4">
          {items.map((m) => (
            <li key={m.id}>
              <MissionCard
                mission={m}
                category={labels.get(m.taxonomyNodeId) ?? null}
                locale={locale}
                now={now}
              />
            </li>
          ))}
        </ul>
      )}

      {(cursor !== undefined || page?.pageInfo.nextCursor != null) && (
        <nav className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {cursor !== undefined && (
            <Button asChild variant="ghost">
              <Link href={browseHref(filters)}>{t('missions.browse.first')}</Link>
            </Button>
          )}
          {page?.pageInfo.nextCursor != null && (
            <Button asChild variant="outline" className="sm:ml-auto">
              <Link href={browseHref(filters, page.pageInfo.nextCursor)}>
                {t('missions.browse.next')}
              </Link>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
