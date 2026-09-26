import { House } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { AgencyChecklist } from '@/components/home/agency-checklist';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';
import { serverApi } from '@/lib/api/server';
import type { WorkspaceView } from '@/lib/api/types';

/**
 * Home: what needs the reader. In an agency, its owner first sees what is left of its setup
 * (T-149); everything else is still to come, and the empty state says what will gather here.
 */
export default async function HomePage() {
  const [t, workspaces] = await Promise.all([getT(), serverApi<WorkspaceView[]>('/workspaces')]);
  const inAgency = (workspaces ?? []).some((w) => w.current && w.kind === 'AGENCY');
  return (
    <Page title={t('nav.home')}>
      {inAgency && <AgencyChecklist />}
      <EmptyState icon={House} title={t('home.empty.title')} body={t('home.empty.body')} />
    </Page>
  );
}
