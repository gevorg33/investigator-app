import { MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { t } from '@/i18n/messages';

export const metadata: Metadata = { title: t('nav.messages') };

export default function MessagesPage() {
  return (
    <Page title={t('nav.messages')}>
      <EmptyState
        icon={MessagesSquare}
        title={t('messages.empty.title')}
        body={t('messages.empty.body')}
      />
    </Page>
  );
}
