import { UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { t } from '@/i18n/messages';

export const metadata: Metadata = { title: t('nav.account') };

export default function AccountPage() {
  return (
    <Page title={t('nav.account')}>
      <EmptyState
        icon={UserRound}
        title={t('account.empty.title')}
        body={t('account.empty.body')}
      />
    </Page>
  );
}
