import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { parseDiscovery, type SearchParams } from '@/components/discovery/discovery-query';
import { InvestigatorDiscovery } from '@/components/discovery/investigator-discovery';
import { actsAsInvestigator, MissionsViews } from '@/components/discovery/missions-views';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, serverApi } from '@/lib/api/server';
import type { TaxonomyNode } from '@/lib/api/types';
import { countryOptions, languageOptions } from '@/lib/codes';
import { categoryOptions } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('missions.discovery.title') };
}

/**
 * Finding investigators (T-120): a customer's second view of Missions. Someone working as an
 * investigator is sent back to Missions, where their view is the open missions to quote on — to
 * hire, they show the platform as a customer. The reference lists are the server's `Intl` and
 * taxonomy, passed down so the browser hydrates what the server rendered.
 */
export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [t, { locale }, account, params] = await Promise.all([
    getT(),
    getLocale(),
    getAccount(),
    searchParams,
  ]);
  if (actsAsInvestigator(account)) redirect('/missions');
  const taxonomy = await serverApi<TaxonomyNode[]>(`/taxonomy?locale=${locale}`);
  return (
    <Page title={t('nav.missions')}>
      <MissionsViews current="find" />
      <InvestigatorDiscovery
        filters={parseDiscovery(params)}
        categories={categoryOptions(taxonomy ?? [])}
        countries={countryOptions(locale)}
        languages={languageOptions(locale)}
        locale={locale}
      />
    </Page>
  );
}
