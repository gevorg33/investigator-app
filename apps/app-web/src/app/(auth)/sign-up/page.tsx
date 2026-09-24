import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, serverApi } from '@/lib/api/server';
import type { LegalDocument } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.sign_up.title') };
}

export default async function SignUpPage() {
  if ((await getAccount()) !== null) redirect('/');
  const [t, { locale }] = await Promise.all([getT(), getLocale()]);
  // What registration requires is the API's to say (legal.policy.ts), in the reader's language
  // where translated — the ids posted back record exactly what was shown.
  const documents =
    (await serverApi<LegalDocument[]>(`/legal/required?for=registration&locale=${locale}`)) ?? [];
  return (
    <AuthCard title={t('auth.sign_up.title')}>
      <SignUpForm documents={documents} />
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="text-text-muted">{t('auth.sign_up.have_account')}</span>
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('auth.sign_up.sign_in')}
        </Link>
      </p>
    </AuthCard>
  );
}
