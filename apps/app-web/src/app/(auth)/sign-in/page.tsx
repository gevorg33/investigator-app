import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { GoogleButton, OrDivider } from '@/components/auth/google-button';
import { SignInForm } from '@/components/auth/sign-in-form';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { getT } from '@/i18n/server';
import { getAccount, serverApi } from '@/lib/api/server';
import { safeNext } from '@/lib/safe-next';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.sign_in.title') };
}

type Search = Promise<{ next?: string; reset?: string; verified?: string; google?: string }>;

/** What the Google callback may say it went wrong with (T-062); anything else says nothing. */
const GOOGLE_FAILURES = ['denied', 'failed', 'unverified', 'exists'] as const;

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const { next, reset, verified, google } = await searchParams;
  const target = safeNext(next);
  if ((await getAccount()) !== null) redirect(target);
  const [t, providers] = await Promise.all([
    getT(),
    serverApi<{ google: boolean }>('/auth/providers'),
  ]);
  const failure = GOOGLE_FAILURES.find((f) => f === google);
  const notice =
    reset === 'done'
      ? t('auth.sign_in.reset_done')
      : verified === '1'
        ? t('auth.sign_in.verified')
        : null;
  return (
    <AuthCard title={t('auth.sign_in.title')}>
      {notice !== null && (
        <Alert>
          <AlertContent>
            <AlertTitle>{notice}</AlertTitle>
          </AlertContent>
        </Alert>
      )}
      {failure !== undefined && (
        <Alert variant="destructive">
          <AlertContent>
            <AlertTitle>{t(`auth.google.${failure}`)}</AlertTitle>
          </AlertContent>
        </Alert>
      )}
      {providers!.google && (
        <>
          <GoogleButton label={t('auth.google.continue')} next={target} />
          <OrDivider label={t('auth.google.or')} />
        </>
      )}
      <SignInForm next={target} />
      <div className="grid gap-1 text-sm">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('auth.sign_in.forgot')}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="text-text-muted">{t('auth.sign_in.new_here')}</span>
          <Link
            // Somewhere to come back to — an invitation (T-158) — survives choosing to sign up.
            href={target === '/' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(target)}`}
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.sign_in.create_account')}
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
