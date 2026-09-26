import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { AcceptInvitation, ForgetQuery } from '@/components/auth/accept-invitation';
import { Button } from '@/components/ui/button';
import { getT } from '@/i18n/server';
import { getAccount } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  // The token is in this page's URL: it must not travel onward in a Referer header.
  return { title: (await getT())('auth.invitation.title'), referrer: 'no-referrer' };
}

const LINK =
  'inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline';

/**
 * Where an invitation email leads (T-158). Signed in with the invited, confirmed address: a button
 * that joins. Signed out: sign in or create the account, and come back here — the way back is
 * carried as `next`, through sign-up's "check your email" too. Signed in but not yet confirmed: the
 * address has to be confirmed first, and the API would refuse it anyway.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const [t, account] = await Promise.all([getT(), getAccount()]);
  const title = t('auth.invitation.title');

  if (!token) {
    return (
      <AuthCard title={title}>
        <p className="text-text-muted">{t('auth.invitation.missing')}</p>
        <Link href="/" className={LINK}>
          {t('auth.invitation.home')}
        </Link>
      </AuthCard>
    );
  }

  const back = `/invitations/accept?token=${encodeURIComponent(token)}`;
  const next = `next=${encodeURIComponent(back)}`;

  if (account === null) {
    return (
      <AuthCard title={title}>
        <ForgetQuery />
        <p className="text-text-muted">{t('auth.invitation.signed_out')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button asChild>
            <Link href={`/sign-in?${next}`}>{t('auth.invitation.sign_in')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-up?${next}`}>{t('auth.invitation.create_account')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (!account.emailVerified) {
    return (
      <AuthCard title={title}>
        <ForgetQuery />
        <p className="text-text-muted">
          {t('auth.invitation.unconfirmed', { email: account.email })}
        </p>
        <Link href={`/check-email?${next}`} className={LINK}>
          {t('auth.invitation.confirm_link')}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title}>
      <AcceptInvitation token={token} email={account.email} />
    </AuthCard>
  );
}
