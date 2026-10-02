import type { Metadata } from 'next';
import { AgencyNav } from '@/components/agency/console/agency-nav';
import { currentAgency } from '@/components/agency/console/current-agency';
import { Invitations } from '@/components/agency/console/invitations';
import { Members } from '@/components/agency/console/members';
import { Page } from '@/components/page';
import { SectionCard } from '@/components/section-card';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, serverApi } from '@/lib/api/server';
import type { EmployeeView, InvitationView } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('agency.people.title') };
}

/**
 * The agency's people (T-093): its members — details, roles, suspending and removing — and the
 * invitations still open. Every member may read both (`employees.read`); what each may change is the
 * API's to say, and a refusal says so where it happened.
 */
export default async function PeoplePage() {
  const agency = await currentAgency();
  const [t, { locale }, account, members, invitations] = await Promise.all([
    getT(),
    getLocale(),
    getAccount(),
    serverApi<EmployeeView[]>('/agencies/current/members'),
    serverApi<InvitationView[]>('/agencies/current/invitations'),
  ]);
  return (
    <Page title={t('agency.people.title')}>
      <p className="mt-1 text-sm text-text-muted">
        {t('agency.people.intro', { name: agency.name })}
      </p>
      <AgencyNav />
      <SectionCard
        id="members"
        title={t('agency.people.members_title')}
        body={t('agency.people.members_body')}
      >
        <Members members={members ?? []} />
      </SectionCard>
      <SectionCard
        id="invitations"
        title={t('agency.invitations.title')}
        body={t('agency.invitations.body')}
      >
        <Invitations invitations={invitations ?? []} locale={locale} timeZone={account!.timezone} />
      </SectionCard>
    </Page>
  );
}
