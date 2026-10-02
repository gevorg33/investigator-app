import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgencyNav } from '@/components/agency/console/agency-nav';
import { currentAgency } from '@/components/agency/console/current-agency';
import { memberName } from '@/components/agency/console/shared';
import { AvailabilityEditor } from '@/components/investigator/availability-editor';
import { DetailsForm } from '@/components/investigator/details-form';
import { LanguagesEditor } from '@/components/investigator/languages-editor';
import { ProfileTargetProvider } from '@/components/investigator/profile-target';
import { heldProfile } from '@/components/investigator/profile-target-paths';
import { ServiceAreas } from '@/components/investigator/service-areas';
import { SpecialtiesPicker } from '@/components/investigator/specialties-picker';
import { StatusCard } from '@/components/investigator/status-card';
import { Page } from '@/components/page';
import { Alert, AlertContent } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { SectionCard } from '@/components/section-card';
import { getLocale, getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type {
  AgencyInvestigatorView,
  EmployeeView,
  OwnServiceArea,
  TaxonomyNode,
} from '@/lib/api/types';
import { countryOptions, languageOptions } from '@/lib/codes';
import { investigatorName } from '@/lib/investigator-name';
import { categoryOptions } from '@/lib/taxonomy';

type Props = { params: Promise<{ id: string }> };

/** The profile, or the not-found page: another agency's, a Personal one and none look the same. */
async function held(id: string): Promise<AgencyInvestigatorView> {
  try {
    const found = await serverApi<AgencyInvestigatorView>(
      `/agencies/current/investigators/${encodeURIComponent(id)}`,
    );
    if (found === null) notFound();
    return found;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [t, profile] = await Promise.all([getT(), held((await params).id)]);
  return {
    title: investigatorName(profile, (code) => t('investigator.public_name.unnamed', { code })),
  };
}

/**
 * One profile the agency holds (T-093): the same sections an investigator edits on their own
 * profile, writing to the agency's routes — the storefront only. The holder's legal name and their
 * choice of name are theirs, and verification is not applied for from here (T-071).
 */
export default async function HeldInvestigatorPage({ params }: Props) {
  const { id } = await params;
  await currentAgency();
  const [t, { locale }] = await Promise.all([getT(), getLocale()]);
  const profile = await held(id);
  const [areas, taxonomy, members] = await Promise.all([
    serverApi<OwnServiceArea[]>(
      `/agencies/current/investigators/${encodeURIComponent(id)}/service-areas`,
    ),
    serverApi<TaxonomyNode[]>(`/taxonomy?locale=${locale}`),
    serverApi<EmployeeView[]>('/agencies/current/members'),
  ]);
  const categories = categoryOptions(taxonomy ?? []);
  const holder = (members ?? []).find((m) => m.membershipId === profile.membershipId);
  const person = holder === undefined ? (profile.displayName ?? '') : memberName(holder);

  return (
    <Page
      title={investigatorName(profile, (code) => t('investigator.public_name.unnamed', { code }))}
    >
      <Link
        href="/agency/investigators"
        className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('agency.investigators.back')}
      </Link>
      <p className="text-sm text-text-muted">{t('agency.investigators.held_by', { person })}</p>
      {profile.holderStatus !== 'ACTIVE' && (
        <Alert className="mt-4">
          <CircleAlert aria-hidden />
          <AlertContent>
            <p className="text-sm">{t('agency.investigators.holder_inactive_note', { person })}</p>
          </AlertContent>
        </Alert>
      )}
      <AgencyNav />
      <ProfileTargetProvider target={heldProfile(profile.id)}>
        <StatusCard
          profile={profile}
          areas={(areas ?? []).length}
          specialties={categories.map((c) => [c.id, c.label] as const)}
        />
        <SectionCard id="details" title={t('agency.investigators.sections.details_title')}>
          <DetailsForm profile={profile} currencies={Intl.supportedValuesOf('currency')} />
        </SectionCard>
        <SectionCard
          id="languages"
          title={t('investigator.languages.title')}
          body={t('agency.investigators.sections.languages_body')}
        >
          <LanguagesEditor languages={profile.languages} options={languageOptions(locale)} />
        </SectionCard>
        <SectionCard
          id="specialties"
          title={t('investigator.specialties.title')}
          body={t('agency.investigators.sections.specialties_body')}
        >
          <SpecialtiesPicker chosen={profile.specialtyNodeIds} categories={categories} />
        </SectionCard>
        <SectionCard
          id="availability"
          title={t('investigator.availability.title')}
          body={t('agency.investigators.sections.availability_body')}
        >
          <AvailabilityEditor windows={profile.availability} />
        </SectionCard>
        <SectionCard
          id="areas"
          title={t('agency.investigators.sections.areas_title')}
          body={t('investigator.areas.body')}
        >
          <ServiceAreas areas={areas ?? []} countries={countryOptions(locale)} />
        </SectionCard>
        <SectionCard
          id="verification"
          title={t('agency.investigators.verification_title')}
          body={t('agency.investigators.verification_body')}
        >
          <p>
            <Badge variant={profile.verificationStatus === 'VERIFIED' ? 'default' : 'outline'}>
              {t(`investigator.verification_status.${profile.verificationStatus}`)}
            </Badge>
          </p>
        </SectionCard>
      </ProfileTargetProvider>
    </Page>
  );
}
