import { ChevronRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalOutstandingForm } from '@/components/account/legal-outstanding';
import { ProfileSection } from '@/components/account/profile-section';
import { RolesSection } from '@/components/account/roles-section';
import { AccountSection } from '@/components/account/section';
import { SessionsSection } from '@/components/account/sessions-section';
import { TimeZoneForm } from '@/components/account/time-zone-form';
import { LanguageChoice } from '@/components/language-choice';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { AGENCY_DETAILS_HREF } from '@/components/workspace/agency-setup-notice';
import { CREATE_AGENCY_HREF } from '@/components/workspace/workspace-switcher';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, getOutstanding, serverApi } from '@/lib/api/server';
import type { WorkspaceView } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('nav.account') };
}

/**
 * The account (T-127): what it still has to accept first, then who it is, its roles, agencies
 * (T-092), language, time zone and sessions. The workspace layout has already required a session.
 *
 * Working in an agency, the agencies section leads to that agency's profile and colours (T-094).
 */
export default async function AccountPage() {
  const [t, { locale }, account, outstanding, workspaces] = await Promise.all([
    getT(),
    getLocale(),
    getAccount(),
    getOutstanding(),
    serverApi<WorkspaceView[]>('/workspaces'),
  ]);
  // In an agency, its details (T-150) and its profile (T-094) are a tap away; each page decides
  // what the reader may change.
  const agency = (workspaces ?? []).find((w) => w.current && w.kind === 'AGENCY');
  const agencyLinks = [
    {
      href: AGENCY_DETAILS_HREF,
      title: 'workspace.agency_details.link',
      body: 'workspace.agency_details.link_body',
    },
    { href: '/agency', title: 'agency.link', body: 'agency.link_body' },
  ] as const;
  return (
    <Page title={t('nav.account')}>
      {outstanding.length > 0 && (
        <AccountSection id="legal" title={t('account.legal.title')}>
          <LegalOutstandingForm documents={outstanding} />
        </AccountSection>
      )}
      <ProfileSection account={account!} />
      <RolesSection account={account!} locale={locale} />
      <AccountSection
        id="agencies"
        title={t('workspace.agencies.title')}
        body={t('workspace.agencies.body')}
      >
        {agency !== undefined &&
          agencyLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-4 py-3 hover:bg-surface-sunken"
            >
              <span className="grid gap-0.5">
                <span className="font-medium">{t(link.title)}</span>
                <span className="text-sm text-text-muted">
                  {t(link.body, { name: agency.name! })}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
            </Link>
          ))}
        {account!.emailVerified ? (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={CREATE_AGENCY_HREF}>
              <Plus aria-hidden />
              {t('workspace.create')}
            </Link>
          </Button>
        ) : (
          <p className="text-sm">{t('account.roles.verify_first')}</p>
        )}
      </AccountSection>
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
