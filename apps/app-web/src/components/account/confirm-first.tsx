import { MailCheck } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { getT } from '@/i18n/server';
import { ResendVerification } from './resend-verification';

/**
 * In place of what the API shows only to an active account, while this one's address is still
 * unconfirmed (T-164): what opens it, and a new link to do so. The page does not ask the API for
 * what it would refuse.
 */
export async function ConfirmFirst({ email }: { email: string }) {
  const t = await getT();
  return (
    <EmptyState
      icon={MailCheck}
      title={t('account.confirm_first.title')}
      body={t('account.confirm_first.body')}
    >
      <ResendVerification email={email} />
    </EmptyState>
  );
}
