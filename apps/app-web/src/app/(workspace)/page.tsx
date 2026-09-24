import { House } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { t } from '@/i18n/messages';

export default function HomePage() {
  return (
    <Page title={t('nav.home')}>
      <EmptyState icon={House} title={t('home.empty.title')} body={t('home.empty.body')} />
    </Page>
  );
}
