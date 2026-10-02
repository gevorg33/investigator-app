import type { Metadata } from 'next';
import { AgencyNav } from '@/components/agency/console/agency-nav';
import { currentAgency } from '@/components/agency/console/current-agency';
import { AgencyInvestigators } from '@/components/agency/console/investigators';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';
import { serverApi } from '@/lib/api/server';
import type { AgencyInvestigatorView, EmployeeView } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('agency.investigators.title') };
}

/**
 * The investigator profiles the agency runs for its members (T-093, T-087), and making one for a
 * member who has none here yet.
 */
export default async function AgencyInvestigatorsPage() {
  const agency = await currentAgency();
  const [t, profiles, members] = await Promise.all([
    getT(),
    serverApi<AgencyInvestigatorView[]>('/agencies/current/investigators'),
    serverApi<EmployeeView[]>('/agencies/current/members'),
  ]);
  return (
    <Page title={t('agency.investigators.title')}>
      <p className="mt-1 text-sm text-text-muted">
        {t('agency.investigators.intro', { name: agency.name })}
      </p>
      <AgencyNav />
      <div className="mt-6">
        <AgencyInvestigators profiles={profiles ?? []} members={members ?? []} />
      </div>
    </Page>
  );
}
