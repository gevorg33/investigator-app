import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmFirst } from '@/components/account/confirm-first';
import { BlockPerson } from '@/components/blocks/block-person';
import { Unblock } from '@/components/blocks/unblock';
import { DISCOVERY_PATH } from '@/components/discovery/discovery-query';
import { ProfileReviews } from '@/components/discovery/profile-reviews';
import { PublicProfileCard } from '@/components/investigator/public-profile-card';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { getAccount, serverApi } from '@/lib/api/server';
import { investigatorName } from '@/lib/investigator-name';
import type {
  BlockView,
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
  return {
    title: investigatorName(profile, (code) => t('investigator.public_name.unnamed', { code })),
  };
}

/**
 * An investigator's public profile (T-120): exactly the public projection — the same component
 * the investigator previews themselves with (T-123) — and their reviews (T-037). Areas are not
 * shown: the public projection carries none, and a customer sees how far an investigator is in
 * the search instead, never where their areas lie (`discovery.md`). Reviews the API shows to an
 * active account only: until the address is confirmed, that comes first in their place.
 */
export default async function InvestigatorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, { locale }, profile, account] = await Promise.all([
    getT(),
    getLocale(),
    profileOf(id),
    getAccount(),
  ]);
  const confirmed = account!.emailVerified;
  const [reviews, taxonomy, blocks] = await Promise.all([
    confirmed
      ? serverApi<Reviews>(`/profiles/investigator/${encodeURIComponent(id)}/reviews`)
      : null,
    serverApi<TaxonomyNode[]>(`/taxonomy?locale=${locale}`),
    confirmed ? serverApi<{ items: BlockView[] }>('/blocks') : null,
  ]);
  const block = blocks?.items.find((b) => b.investigatorProfileId === profile.id);
  const specialties = new Map(categoryOptions(taxonomy ?? []).map((c) => [c.id, c.label]));
  return (
    <Page
      title={investigatorName(profile, (code) => t('investigator.public_name.unnamed', { code }))}
    >
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
      {/* T-052: one's own block, and its undoing, are the reader's to see; nothing here tells the
          investigator anything. */}
      {confirmed && (
        <div className="mt-4">
          {block === undefined ? (
            <BlockPerson target={{ investigatorProfileId: profile.id }} />
          ) : (
            <div className="grid gap-3 rounded-md border border-border p-4 sm:flex sm:items-center sm:justify-between">
              <p role="status" className="text-sm">
                {t('account.block.blocked')}
              </p>
              <Unblock id={block.id} />
            </div>
          )}
        </div>
      )}
      {confirmed ? (
        <ProfileReviews profileId={profile.id} initial={reviews!} />
      ) : (
        <section aria-labelledby="reviews-title" className="mt-8 grid gap-4">
          <h2 id="reviews-title" className="text-xl font-semibold">
            {t('missions.profile.reviews')}
          </h2>
          <ConfirmFirst email={account!.email} />
        </section>
      )}
    </Page>
  );
}
