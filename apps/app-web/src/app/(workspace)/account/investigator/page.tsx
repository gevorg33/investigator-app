import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AvailabilityEditor } from '@/components/investigator/availability-editor';
import { DetailsForm } from '@/components/investigator/details-form';
import { LanguagesEditor } from '@/components/investigator/languages-editor';
import { SectionCard } from '@/components/investigator/section-card';
import { ServiceAreas } from '@/components/investigator/service-areas';
import { SpecialtiesPicker } from '@/components/investigator/specialties-picker';
import { StatusCard } from '@/components/investigator/status-card';
import { VerificationSection } from '@/components/investigator/verification-section';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { getAccount, serverApi } from '@/lib/api/server';
import type {
  OwnInvestigatorProfile,
  OwnServiceArea,
  PublicInvestigatorProfile,
  TaxonomyNode,
  VerificationApplication,
} from '@/lib/api/types';
import { countryOptions, languageOptions } from '@/lib/codes';
import { categoryOptions } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('investigator.title') };
}

/**
 * The investigator's own profile (T-123): where it stands, what it says, where they work, and
 * verification — everything that decides whether customers find them and they see open missions.
 * Only for someone who holds the role; anyone else is sent to Account, where it is added.
 */
export default async function InvestigatorProfilePage() {
  const account = await getAccount();
  if (account === null || !account.roles.includes('INVESTIGATOR')) redirect('/account#roles');
  const [t, { locale }] = await Promise.all([getT(), getLocale()]);
  const [profile, preview, areas, applications, taxonomy] = await Promise.all([
    serverApi<OwnInvestigatorProfile>('/profiles/investigator/me'),
    serverApi<PublicInvestigatorProfile>('/profiles/investigator/me/preview'),
    serverApi<OwnServiceArea[]>('/service-areas/me'),
    serverApi<VerificationApplication[]>('/verification/me/requests'),
    serverApi<TaxonomyNode[]>(`/taxonomy?locale=${locale}`),
  ]);
  const categories = categoryOptions(taxonomy ?? []);
  const own = profile!;

  return (
    <Page title={t('investigator.title')}>
      <p className="mt-1 text-sm text-text-muted">{t('investigator.intro')}</p>
      <StatusCard
        profile={own}
        preview={preview!}
        areas={(areas ?? []).length}
        specialties={categories.map((c) => [c.id, c.label] as const)}
      />
      <SectionCard id="details" title={t('investigator.details.title')}>
        <DetailsForm profile={own} currencies={Intl.supportedValuesOf('currency')} />
      </SectionCard>
      <SectionCard
        id="languages"
        title={t('investigator.languages.title')}
        body={t('investigator.languages.body')}
      >
        <LanguagesEditor languages={own.languages} options={languageOptions(locale)} />
      </SectionCard>
      <SectionCard
        id="specialties"
        title={t('investigator.specialties.title')}
        body={t('investigator.specialties.body')}
      >
        <SpecialtiesPicker chosen={own.specialtyNodeIds} categories={categories} />
      </SectionCard>
      <SectionCard
        id="availability"
        title={t('investigator.availability.title')}
        body={t('investigator.availability.body')}
      >
        <AvailabilityEditor windows={own.availability} />
      </SectionCard>
      <SectionCard
        id="areas"
        title={t('investigator.areas.title')}
        body={t('investigator.areas.body')}
      >
        <ServiceAreas areas={areas ?? []} countries={countryOptions(locale)} />
      </SectionCard>
      <SectionCard
        id="verification"
        title={t('investigator.verification.title')}
        body={t('investigator.verification.body')}
      >
        <VerificationSection applications={applications ?? []} />
      </SectionCard>
    </Page>
  );
}
