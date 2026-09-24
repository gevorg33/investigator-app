import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { EmailLinkForm } from '@/components/auth/email-link-form';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.forgot.title') };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <AuthCard title={t('auth.forgot.title')}>
      <p className="text-text-muted">{t('auth.forgot.body')}</p>
      <EmailLinkForm
        endpoint="/auth/password-reset"
        submit={t('auth.forgot.submit')}
        done={t('auth.forgot.sent')}
      />
      <Link
        href="/sign-in"
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('auth.forgot.back')}
      </Link>
    </AuthCard>
  );
}
