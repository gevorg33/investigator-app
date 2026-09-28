import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { GoogleSignupForm } from '@/components/auth/google-signup-form';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, serverApi } from '@/lib/api/server';
import type { LegalDocument } from '@/lib/api/types';
import { safeNext } from '@/lib/safe-next';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.google.signup_title') };
}

/**
 * Where a first sign-in with Google lands (T-062): the account does not exist yet, and is created
 * here once the documents registration requires are accepted — the same ones, in the reader's
 * language, as the email sign-up shows.
 */
export default async function GoogleSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const target = safeNext((await searchParams).next);
  if ((await getAccount()) !== null) redirect(target);
  const [t, { locale }] = await Promise.all([getT(), getLocale()]);
  const documents =
    (await serverApi<LegalDocument[]>(`/legal/required?for=registration&locale=${locale}`)) ?? [];
  return (
    <AuthCard title={t('auth.google.signup_title')}>
      <GoogleSignupForm documents={documents} next={target} />
    </AuthCard>
  );
}
