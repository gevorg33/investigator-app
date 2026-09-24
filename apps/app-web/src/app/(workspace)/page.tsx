import { House } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';

export default async function HomePage() {
  const t = await getT();
  return (
    <Page title={t('nav.home')}>
      <EmptyState icon={House} title={t('home.empty.title')} body={t('home.empty.body')} />
    </Page>
  );
}
