import { Bot } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.assistant') };
}

export default async function AssistantPage() {
  const t = await getT();
  return (
    <Page title={t('nav.assistant')}>
      <EmptyState icon={Bot} title={t('assistant.empty.title')} body={t('assistant.empty.body')} />
    </Page>
  );
}
