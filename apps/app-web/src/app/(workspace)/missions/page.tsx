import { BriefcaseBusiness } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { MissionBrowse } from '@/components/missions/mission-browse';
import type { SearchParams } from '@/components/missions/browse-query';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { getAccount } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.missions') };
}

/**
 * Missions. An investigator — unless they chose to see the platform as a customer — gets the open
 * missions they could quote on (T-054). A customer's own missions are listed here when the mission
 * screens arrive (T-119); until then, the empty state says what will appear.
 */
export default async function MissionsPage({
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
  const investigator =
    account !== null && account.roles.includes('INVESTIGATOR') && account.activeRole !== 'CUSTOMER';
  return (
    <Page title={t('nav.missions')}>
      {investigator ? (
        <MissionBrowse params={params} locale={locale} />
      ) : (
        <EmptyState
          icon={BriefcaseBusiness}
          title={t('missions.empty.title')}
          body={t('missions.empty.body')}
        />
      )}
    </Page>
  );
}
