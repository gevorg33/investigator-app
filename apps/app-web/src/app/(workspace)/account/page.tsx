import type { Metadata } from 'next';
import { LegalOutstandingForm } from '@/components/account/legal-outstanding';
import { ProfileSection } from '@/components/account/profile-section';
import { RolesSection } from '@/components/account/roles-section';
import { AccountSection } from '@/components/account/section';
import { SessionsSection } from '@/components/account/sessions-section';
import { TimeZoneForm } from '@/components/account/time-zone-form';
import { LanguageChoice } from '@/components/language-choice';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, getOutstanding } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.account') };
}

/**
 * The account (T-127): what it still has to accept first, then who it is, its roles, language,
 * time zone and sessions. The workspace layout has already required a session.
 */
export default async function AccountPage() {
  const [t, { locale }, account, outstanding] = await Promise.all([
    getT(),
    getLocale(),
    getAccount(),
    getOutstanding(),
  ]);
  return (
    <Page title={t('nav.account')}>
      {outstanding.length > 0 && (
        <AccountSection id="legal" title={t('account.legal.title')}>
          <LegalOutstandingForm documents={outstanding} />
        </AccountSection>
      )}
      <ProfileSection account={account!} />
      <RolesSection account={account!} locale={locale} />
      <LanguageChoice />
      <AccountSection
        id="timezone"
        title={t('account.timezone.title')}
        body={t('account.timezone.body')}
      >
        <TimeZoneForm current={account!.timezone} />
      </AccountSection>
      <SessionsSection account={account!} locale={locale} />
    </Page>
  );
}
