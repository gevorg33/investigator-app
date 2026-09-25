import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  // The token is in this page's URL: it must not travel onward in a Referer header.
  return { title: (await getT())('auth.reset.title'), referrer: 'no-referrer' };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getT();
  return (
    <AuthCard title={t('auth.reset.title')}>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <p className="text-text-muted">{t('auth.reset.missing')}</p>
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.reset.request_new')}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
