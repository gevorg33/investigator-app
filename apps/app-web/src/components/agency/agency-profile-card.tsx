'use client';

import { MapPin } from 'lucide-react';
import Image from 'next/image';
import { useLocale } from 'use-intl';
import type { PublicAgencyProfile } from '@/lib/api/types';

/** An empty alternative: the image is decoration, and the name beside it says whose it is. */
const DECORATIVE = '';

/**
 * An agency exactly as customers see it (T-094): every field of the public projection and nothing
 * else — it takes a `PublicAgencyProfile`, the type `GET /agencies/:id/profile` answers with. The
 * agency's own page shows it as the preview, the public page shows it as the page: one component,
 * so the two cannot differ.
 *
 * Images are signed, short-lived links (media.md), so they skip Next's optimiser, which would fetch
 * and keep them on our server. Both are decorative: the name beside them says whose they are.
 */
export function AgencyProfileCard({
  profile,
  named = true,
}: {
  profile: PublicAgencyProfile;
  /** False where the page is already headed with the name — the public page. */
  named?: boolean;
}) {
  const locale = useLocale();
  const country =
    profile.countryCode === null
      ? null
      : new Intl.DisplayNames([locale], { type: 'region' }).of(profile.countryCode)!;
  return (
    <article aria-label={named ? undefined : profile.name} className="grid gap-4">
      {profile.cover !== null && (
        <div className="relative aspect-3/1 w-full overflow-hidden rounded-md bg-surface-sunken">
          <Image
            src={profile.cover.signedUrl}
            alt={DECORATIVE}
            fill
            unoptimized
            sizes="100vw"
            className="object-cover"
          />
        </div>
      )}
      <header className="flex items-start gap-3">
        {profile.logo !== null && (
          <Image
            src={profile.logo.signedUrl}
            alt={DECORATIVE}
            width={64}
            height={64}
            unoptimized
            className="size-16 shrink-0 rounded-md border border-border bg-surface-raised object-contain"
          />
        )}
        <div className="grid min-w-0 gap-1">
          {named && <h3 className="text-xl font-semibold break-words">{profile.name}</h3>}
          {profile.headline !== '' && <p className="text-text-muted">{profile.headline}</p>}
          {country !== null && (
            <p className="flex items-center gap-1.5 text-sm">
              <MapPin aria-hidden className="size-4 shrink-0 text-text-muted" />
              {country}
            </p>
          )}
        </div>
      </header>
      {profile.about !== null && (
        <p className="text-sm break-words whitespace-pre-line">{profile.about}</p>
      )}
    </article>
  );
}
