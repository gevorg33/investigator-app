import { UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { LanguageChoice } from '@/components/language-choice';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.account') };
}

export default async function AccountPage() {
  const t = await getT();
  return (
    <Page title={t('nav.account')}>
      <LanguageChoice />
      <EmptyState
        icon={UserRound}
        title={t('account.empty.title')}
        body={t('account.empty.body')}
      />
    </Page>
  );
}
