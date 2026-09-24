import { Bot } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { t } from '@/i18n/messages';

export const metadata: Metadata = { title: t('nav.assistant') };

export default function AssistantPage() {
  return (
    <Page title={t('nav.assistant')}>
      <EmptyState icon={Bot} title={t('assistant.empty.title')} body={t('assistant.empty.body')} />
    </Page>
  );
}
