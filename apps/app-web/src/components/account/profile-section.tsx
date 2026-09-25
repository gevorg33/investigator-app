import { CircleCheck, CircleDashed } from 'lucide-react';
import { getT } from '@/i18n/server';
import type { Account } from '@/lib/api/server';
import { ResendVerification } from './resend-verification';
import { AccountSection } from './section';

/** Who is signed in, and whether their address is confirmed — with a new link when it is not. */
export async function ProfileSection({ account }: { account: Account }) {
  const t = await getT();
  return (
    <AccountSection id="profile" title={t('account.profile.title')}>
      <dl className="grid gap-1 text-sm">
        <dt className="text-text-muted">{t('account.profile.email')}</dt>
        <dd className="flex flex-wrap items-center gap-2 font-medium break-all">
          {account.email}
          {account.emailVerified ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CircleCheck aria-hidden className="size-4" />
              {t('account.profile.verified')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-warning">
              <CircleDashed aria-hidden className="size-4" />
              {t('account.profile.unverified')}
            </span>
          )}
        </dd>
      </dl>
      {!account.emailVerified && <ResendVerification email={account.email} />}
    </AccountSection>
  );
}
