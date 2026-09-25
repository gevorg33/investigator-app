import { FileClock } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { CreateAgencyForm } from '@/components/workspace/create-agency-form';
import { getLocale, getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { getAccount, serverApi } from '@/lib/api/server';
import type { LegalDocument } from '@/lib/api/types';
import { countryOptions } from '@/lib/codes';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('workspace.create_agency.title') };
}

/** The agency terms in force, in the reader's language where translated — or none published. */
async function agencyTerms(locale: string): Promise<LegalDocument | null> {
  try {
    return await serverApi<LegalDocument>(`/legal/documents/AGENCY_AGREEMENT?locale=${locale}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Creating an agency (T-092). The agency terms are the gate: until a version is published there is
 * nothing to accept, the API refuses every agency, and this page says so rather than offering a
 * form that cannot succeed. Reference lists are the server's `Intl`, so the browser hydrates the
 * list the server rendered.
 */
export default async function CreateAgencyPage() {
  const [t, { locale }, account] = await Promise.all([getT(), getLocale(), getAccount()]);
  const terms = await agencyTerms(locale);
  const own = account!;
  // The account's own zone is offered first even where this runtime's list lacks it.
  const known = Intl.supportedValuesOf('timeZone');
  const timezones = known.includes(own.timezone) ? known : [own.timezone, ...known];
  return (
    <Page title={t('workspace.create_agency.title')}>
      {!own.emailVerified ? (
        // The API creates agencies for active accounts only: confirming the address comes first.
        <p className="mt-4 text-sm">{t('account.roles.verify_first')}</p>
      ) : terms === null ? (
        <EmptyState
          icon={FileClock}
          title={t('workspace.create_agency.unavailable_title')}
          body={t('workspace.create_agency.unavailable_body')}
        />
      ) : (
        <>
          <p className="mt-1 text-sm text-text-muted">{t('workspace.create_agency.intro')}</p>
          <CreateAgencyForm
            agreement={terms}
            countries={countryOptions(locale)}
            currencies={Intl.supportedValuesOf('currency')}
            timezones={timezones}
            timezone={own.timezone}
          />
        </>
      )}
    </Page>
  );
}
