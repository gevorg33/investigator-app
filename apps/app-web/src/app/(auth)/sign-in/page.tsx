import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { SignInForm } from '@/components/auth/sign-in-form';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { getT } from '@/i18n/server';
import { getAccount } from '@/lib/api/server';
import { safeNext } from '@/lib/safe-next';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.sign_in.title') };
}

type Search = Promise<{ next?: string; reset?: string; verified?: string }>;

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const { next, reset, verified } = await searchParams;
  const target = safeNext(next);
  if ((await getAccount()) !== null) redirect(target);
  const t = await getT();
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
            href="/sign-up"
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.sign_in.create_account')}
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
