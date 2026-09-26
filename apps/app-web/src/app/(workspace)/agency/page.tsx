import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandingForm } from '@/components/agency/branding-form';
import { ProfileEditor } from '@/components/agency/profile-editor';
import { Page } from '@/components/page';
import { SectionCard } from '@/components/section-card';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type { BrandingSection, OwnAgencyProfile, WorkspaceView } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('agency.title') };
}

/** A read the reader's role may not include: null for the API's 403, anything else thrown. */
async function unlessForbidden<T>(read: Promise<T | null>): Promise<T | null> {
  try {
    return await read;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/**
 * The agency's own profile and colours (T-094), in the agency workspace the reader is working in.
 * Anywhere else there is no agency to show, so the reader is sent to Account's agencies.
 *
 * Which member may read or change what is the API's to say (`company.*`, `settings.*`), never a
 * role name here: a section the reader's role does not include says so instead of a form.
 */
export default async function AgencyPage() {
  const workspaces = (await serverApi<WorkspaceView[]>('/workspaces')) ?? [];
  const current = workspaces.find((w) => w.current);
  if (current?.kind !== 'AGENCY') redirect('/account#agencies');
  const registeredName = current.name!;
  const [t, profile, settings] = await Promise.all([
    getT(),
    unlessForbidden(serverApi<OwnAgencyProfile>('/agencies/current/profile')),
    unlessForbidden(serverApi<{ branding: BrandingSection }>('/agencies/current/settings')),
  ]);
  const forbidden = (
    <Alert>
      <AlertContent>
        <AlertTitle>{t('agency.forbidden_title')}</AlertTitle>
        <p className="text-sm">{t('agency.forbidden_body')}</p>
      </AlertContent>
    </Alert>
  );
  return (
    <Page title={t('agency.title')}>
      <p className="mt-1 text-sm text-text-muted">
        {t('agency.intro', { name: profile?.name ?? registeredName })}
      </p>
      <SectionCard id="profile" title={t('agency.profile.title')} body={t('agency.profile.body')}>
        {profile === null ? (
          forbidden
        ) : (
          <ProfileEditor initial={profile} registeredName={registeredName} />
        )}
      </SectionCard>
      <SectionCard
        id="branding"
        title={t('agency.branding.title')}
        body={t('agency.branding.body')}
      >
        {settings === null ? forbidden : <BrandingForm initial={settings.branding} />}
      </SectionCard>
    </Page>
  );
}
