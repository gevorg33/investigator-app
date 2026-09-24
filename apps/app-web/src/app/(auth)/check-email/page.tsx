import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { EmailLinkForm } from '@/components/auth/email-link-form';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.check_email.title') };
}

/** After signing up, or when a link has expired. The address is not in the URL: it is personal. */
export default async function CheckEmailPage() {
  const t = await getT();
  return (
    <AuthCard title={t('auth.check_email.title')}>
      <p className="text-text-muted">{t('auth.check_email.body')}</p>
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
