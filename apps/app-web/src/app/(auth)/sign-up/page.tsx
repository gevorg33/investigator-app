import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { GoogleButton, OrDivider } from '@/components/auth/google-button';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, serverApi } from '@/lib/api/server';
import type { LegalDocument } from '@/lib/api/types';
import { safeNext } from '@/lib/safe-next';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.sign_up.title') };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const target = safeNext((await searchParams).next);
  if ((await getAccount()) !== null) redirect(target);
  const [t, { locale }] = await Promise.all([getT(), getLocale()]);
  // What registration requires is the API's to say (legal.policy.ts), in the reader's language
  // where translated — the ids posted back record exactly what was shown.
  const [documents, providers] = await Promise.all([
    serverApi<LegalDocument[]>(`/legal/required?for=registration&locale=${locale}`),
    serverApi<{ google: boolean }>('/auth/providers'),
  ]);
  return (
    <AuthCard title={t('auth.sign_up.title')}>
      {providers!.google && (
        <>
          {/* The documents are shown after Google, before the account exists (T-062). */}
          <GoogleButton label={t('auth.google.continue')} next={target} />
          <OrDivider label={t('auth.google.or')} />
        </>
      )}
      <SignUpForm documents={documents ?? []} next={target} />
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="text-text-muted">{t('auth.sign_up.have_account')}</span>
        <Link
          href={target === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(target)}`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('auth.sign_up.sign_in')}
        </Link>
      </p>
    </AuthCard>
  );
}
