import type { Metadata } from 'next';
import { AgencyNav } from '@/components/agency/console/agency-nav';
import { currentAgency } from '@/components/agency/console/current-agency';
import { Teams } from '@/components/agency/console/teams';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';
import { serverApi } from '@/lib/api/server';
import type { EmployeeView, TeamView } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('agency.teams.title') };
}

/** The agency's teams and who is in each (T-093, T-086). Members are offered by name to add. */
export default async function TeamsPage() {
  const agency = await currentAgency();
  const [t, teams, members] = await Promise.all([
    getT(),
    serverApi<TeamView[]>('/agencies/current/teams'),
    serverApi<EmployeeView[]>('/agencies/current/members'),
  ]);
  return (
    <Page title={t('agency.teams.title')}>
      <p className="mt-1 text-sm text-text-muted">
        {t('agency.teams.intro', { name: agency.name })}
      </p>
      <AgencyNav />
      <div className="mt-6">
        <Teams teams={teams ?? []} members={members ?? []} />
      </div>
    </Page>
  );
}
