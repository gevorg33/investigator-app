import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Page } from '@/components/page';
import { AgencyDetailsForm } from '@/components/workspace/agency-details-form';
import { AGENCY_DETAILS, DETAIL_LABEL } from '@/components/workspace/agency-details';
import { MissingDetails } from '@/components/workspace/agency-missing';
import { getLocale, getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type { AgencyDetails } from '@/lib/api/types';
import { countryOptions } from '@/lib/codes';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('workspace.agency_details.title') };
}

/** The agency this request is in, or — in a Personal workspace, which has none — Home. */
async function current(): Promise<AgencyDetails> {
  try {
    return (await serverApi<AgencyDetails>('/agencies/current'))!;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) redirect('/');
    throw e;
  }
}

/**
 * An agency's five core details (T-150): the owner completes or changes them; any other member
 * reads them, and is told who can change them. An unfinished agency says what it still needs —
 * this is where the switcher's "Being set up" leads.
 */
export default async function AgencyDetailsPage() {
  const [t, { locale }, agency] = await Promise.all([getT(), getLocale(), current()]);
  const countries = countryOptions(locale);
  if (agency.mayChange) {
    const known = Intl.supportedValuesOf('timeZone');
    const zone = agency.timezone;
    return (
      <Page title={t('workspace.agency_details.title')}>
        <p className="mt-1 text-sm text-text-muted">{t('workspace.agency_details.intro')}</p>
        <AgencyDetailsForm
          agency={agency}
          countries={countries}
          currencies={Intl.supportedValuesOf('currency')}
          // The agency's own zone stays offered even where this runtime's list lacks it.
          timezones={zone === null || known.includes(zone) ? known : [zone, ...known]}
        />
      </Page>
    );
  }
  const shown = (field: (typeof AGENCY_DETAILS)[number]) => {
    const value = agency[field];
    if (value === null) return '—';
    if (field === 'countryCode') return countries.find((c) => c.code === value)?.name ?? value;
    return field === 'timezone' ? value.replaceAll('_', ' ') : value;
  };
  return (
    <Page title={t('workspace.agency_details.title')}>
      <p className="mt-1 text-sm text-text-muted">{t('workspace.agency_details.owner_only')}</p>
      <div className="mt-6 grid gap-6">
        {agency.status === 'CREATING' && <MissingDetails missing={agency.missing} />}
        <dl className="grid gap-4 sm:grid-cols-2">
          {AGENCY_DETAILS.map((field) => (
            <div key={field} className="grid gap-1">
              <dt className="text-sm text-text-muted">
                {t(`workspace.create_agency.${DETAIL_LABEL[field]}`)}
              </dt>
              <dd className="break-words">{shown(field)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Page>
  );
}
