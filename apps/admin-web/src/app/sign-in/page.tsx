import type { Metadata } from 'next';
import { SignInForm } from '@/components/auth/sign-in-form';
import { t } from '@/i18n/messages';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: t('sign_in.title') };

/** Where a reviewer signs in; `next` brings them back to the page they asked for, on this site only. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-6 px-4 py-10">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">{t('sign_in.title')}</h1>
        <p className="text-text-muted">{t('sign_in.body')}</p>
      </div>
      <SignInForm next={safeNext(next)} />
    </main>
  );
}
