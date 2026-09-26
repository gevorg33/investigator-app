import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { EmailLinkForm } from '@/components/auth/email-link-form';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { safeNext } from '@/lib/safe-next';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.check_email.title') };
}

/**
 * After signing up, or when a link has expired. The address is not in the URL: it is personal.
 *
 * With somewhere to go back to — an invitation (T-158) — it says how: confirm the address from the
 * email, then continue, which signs in and returns there. The confirming link opens where the mail
 * app puts it, usually another tab; this one keeps the way back.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const target = safeNext((await searchParams).next);
  const t = await getT();
  return (
    <AuthCard title={t('auth.check_email.title')}>
      <p className="text-text-muted">{t('auth.check_email.body')}</p>
      {target !== '/' && (
        <p className="grid gap-1">
          <span>{t('auth.check_email.then_continue')}</span>
          <Link
            href={`/sign-in?next=${encodeURIComponent(target)}`}
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.check_email.continue')}
          </Link>
        </p>
      )}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{t('auth.check_email.resend_title')}</h2>
        <EmailLinkForm
          endpoint="/auth/verify-email/resend"
          submit={t('auth.check_email.resend_submit')}
          done={t('auth.check_email.resent')}
        />
      </section>
    </AuthCard>
  );
}
