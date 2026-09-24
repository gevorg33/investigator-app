import { BriefcaseBusiness } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { t } from '@/i18n/messages';

export const metadata: Metadata = { title: t('nav.missions') };

export default function MissionsPage() {
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
