import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DISCOVERY_PATH } from '@/components/discovery/discovery-query';
import { ProfileReviews } from '@/components/discovery/profile-reviews';
import { PublicProfileCard } from '@/components/investigator/public-profile-card';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type {
  ProfileReviews as Reviews,
  PublicInvestigatorProfile,
  TaxonomyNode,
} from '@/lib/api/types';
import { categoryOptions } from '@/lib/taxonomy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The profile, or 404 — the API's answer for a profile that is not published, or not there. */
async function profileOf(id: string): Promise<PublicInvestigatorProfile> {
  if (!UUID.test(id)) notFound();
  try {
    return (await serverApi<PublicInvestigatorProfile>(
      `/profiles/investigator/${encodeURIComponent(id)}`,
    ))!;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const [t, profile] = await Promise.all([getT(), params.then(({ id }) => profileOf(id))]);
  return { title: profile.displayName ?? t('missions.discovery.title') };
}

/**
 * An investigator's public profile (T-120): exactly the public projection — the same component
 * the investigator previews themselves with (T-123) — and their reviews (T-037). Areas are not
 * shown: the public projection carries none, and a customer sees how far an investigator is in
 * the search instead, never where their areas lie (`discovery.md`).
 */
export default async function InvestigatorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, { locale }, profile] = await Promise.all([getT(), getLocale(), profileOf(id)]);
  const [reviews, taxonomy] = await Promise.all([
    serverApi<Reviews>(`/profiles/investigator/${encodeURIComponent(id)}/reviews`),
    serverApi<TaxonomyNode[]>(`/taxonomy?locale=${locale}`),
  ]);
  const specialties = new Map(categoryOptions(taxonomy ?? []).map((c) => [c.id, c.label]));
  return (
    <Page title={profile.displayName ?? t('missions.discovery.title')}>
      <Link
        href={DISCOVERY_PATH}
        className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('missions.profile.back')}
      </Link>
      <div className="mt-4 rounded-lg border border-border bg-surface-raised p-4 md:p-6">
        <PublicProfileCard profile={profile} specialties={specialties} named={false} />
      </div>
      <ProfileReviews profileId={profile.id} initial={reviews!} />
    </Page>
  );
}
