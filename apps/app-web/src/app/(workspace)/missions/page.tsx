import { BriefcaseBusiness } from 'lucide-react';
import type { Metadata } from 'next';
import { actsAsInvestigator, MissionsViews } from '@/components/discovery/missions-views';
import { EmptyState } from '@/components/empty-state';
import { MissionBrowse } from '@/components/missions/mission-browse';
import { OwnMissions } from '@/components/missions/own-missions';
import type { SearchParams } from '@/components/missions/browse-query';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { getAccount } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.missions') };
}

/**
 * Missions. An investigator — unless they chose to see the platform as a customer — gets the open
 * missions they could quote on (T-054). Everyone else gets two views: their own missions (T-119 —
 * a customer's, with a way to start one; anyone without the role is told what will appear), and
 * finding investigators (T-120).
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
  return (
    <Page title={t('nav.missions')}>
      {actsAsInvestigator(account) ? (
        <MissionBrowse params={params} locale={locale} />
      ) : (
        <>
          <MissionsViews current="mine" />
          {account !== null && account.roles.includes('CUSTOMER') ? (
            <OwnMissions locale={locale} now={new Date()} />
          ) : (
            <EmptyState
              icon={BriefcaseBusiness}
              title={t('missions.empty.title')}
              body={t('missions.empty.body')}
            />
          )}
        </>
      )}
    </Page>
  );
}
