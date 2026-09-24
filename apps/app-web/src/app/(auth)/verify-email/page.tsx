import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { VerifyEmail } from '@/components/auth/verify-email';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  // The token is in this page's URL: it must not travel onward in a Referer header.
  return { title: (await getT())('auth.verify.title'), referrer: 'no-referrer' };
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getT();
  return (
    <AuthCard title={t('auth.verify.title')}>
      {token ? (
        <VerifyEmail token={token} />
      ) : (
        <>
          <p className="text-text-muted">{t('auth.verify.missing')}</p>
          <Link
            href="/check-email"
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.verify.request_new')}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
