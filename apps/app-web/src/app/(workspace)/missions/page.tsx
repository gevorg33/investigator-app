import { BriefcaseBusiness } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.missions') };
}

export default async function MissionsPage() {
  const t = await getT();
  return (
    <Page title={t('nav.missions')}>
      <EmptyState
        icon={BriefcaseBusiness}
        title={t('missions.empty.title')}
        body={t('missions.empty.body')}
      />
    </Page>
  );
}
