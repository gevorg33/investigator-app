import { MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.messages') };
}

export default async function MessagesPage() {
  const t = await getT();
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
