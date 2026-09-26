import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AgencyProfileCard } from '@/components/agency/agency-profile-card';
import { Page } from '@/components/page';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type { PublicAgencyProfile } from '@/lib/api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The profile, or 404 — the API's one answer for a draft, a suspended agency, a Personal workspace
 * and an id that is not there. Read once per request, for the title and the page.
 */
const profileOf = cache(async (id: string): Promise<PublicAgencyProfile> => {
  if (!UUID.test(id)) notFound();
  try {
    return (await serverApi<PublicAgencyProfile>(`/agencies/${encodeURIComponent(id)}/profile`))!;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return { title: (await profileOf((await params).id)).name };
}

/**
 * A published agency, as anyone signed in sees it (T-094): the public projection and nothing else,
 * drawn by the component the agency previews itself with — so what it previewed is what this is.
 */
export default async function AgencyPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await profileOf((await params).id);
  return (
    <Page title={profile.name}>
      <div className="mt-6 rounded-lg border border-border bg-surface-raised p-4">
        <AgencyProfileCard profile={profile} named={false} />
      </div>
    </Page>
  );
}
