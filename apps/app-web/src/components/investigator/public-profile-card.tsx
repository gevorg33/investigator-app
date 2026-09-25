'use client';

import { formatBudget, type Locale } from '@investigator/i18n';
import { BadgeCheck, Clock, Languages, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { Badge } from '@/components/ui/badge';
import type { PublicInvestigatorProfile } from '@/lib/api/types';

const minutes = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The weekday name for ISO 8601 day 0 (Monday) to 6, in the reader's language. */
const weekday = (day: number, locale: string) =>
  // 2024-01-01 was a Monday.
  new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 1 + day)),
  );

/**
 * An investigator profile exactly as a customer sees it (T-123): every field of the public
 * projection and nothing else — it takes a `PublicInvestigatorProfile`, the type the API builds
 * with the one function it also builds the public view with. The profile page shows it as the
 * preview; the customer's profile page (T-120) will show the same component.
 */
export function PublicProfileCard({
  profile,
  specialties,
  named = true,
}: {
  profile: PublicInvestigatorProfile;
  /** Labels for the profile's specialty ids, in the reader's language. */
  specialties: ReadonlyMap<string, string>;
  /** False where the page is already headed with the name — the public profile page (T-120). */
  named?: boolean;
}) {
  const t = useTranslations('investigator');
  const locale = useLocale() as Locale;
  const languageNames = new Intl.DisplayNames([locale], { type: 'language' });
  const rate =
    profile.hourlyRateMinor !== null && profile.currency !== null
      ? formatBudget(profile.hourlyRateMinor, profile.currency, locale)
      : null;

  return (
    <article aria-labelledby={named ? 'public-profile-name' : undefined} className="grid gap-4">
      <header className="grid gap-1">
        {named && (
          <h3 id="public-profile-name" className="text-xl font-semibold">
            {profile.displayName ?? t('details.not_set')}
          </h3>
        )}
        {profile.headline !== null && <p className="text-text-muted">{profile.headline}</p>}
        <div className="mt-1 flex flex-wrap gap-2">
          {profile.verified && (
            <Badge variant="secondary">
              <BadgeCheck aria-hidden />
              {t('verification_status.VERIFIED')}
            </Badge>
          )}
          {profile.acceptingWork && <Badge variant="secondary">{t('status.accepting')}</Badge>}
          {profile.yearsExperience !== null && (
            <Badge variant="outline">
              {t('details.years_count', { count: profile.yearsExperience })}
            </Badge>
          )}
        </div>
      </header>

      {profile.bio !== null && <p className="text-sm whitespace-pre-line">{profile.bio}</p>}

      {profile.specialtyNodeIds.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('specialties.title')}>
          {profile.specialtyNodeIds.map((id) => (
            <li key={id}>
              <Badge variant="secondary">{specialties.get(id) ?? id}</Badge>
            </li>
          ))}
        </ul>
      )}

      <ul className="grid gap-2 text-sm">
        {profile.languages.length > 0 && (
          <li className="flex items-start gap-2">
            <Languages aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" />
            <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={t('languages.title')}>
              {profile.languages.map((l) => (
                <li key={l.languageCode}>
                  {languageNames.of(l.languageCode)}{' '}
                  <span className="text-text-muted">{t(`languages.level_${l.proficiency}`)}</span>
                </li>
              ))}
            </ul>
          </li>
        )}
        {profile.pricingModel !== null && (
          <li className="flex items-center gap-2">
            <Wallet aria-hidden className="size-4 shrink-0 text-text-muted" />
            <span>{t(`details.pricing_${profile.pricingModel}`)}</span>
            {rate !== null && (
              <span className="text-text-muted">{t('details.rate_value', { rate })}</span>
            )}
          </li>
        )}
        {profile.availability.length > 0 && (
          <li className="flex items-start gap-2">
            <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" />
            <span>
              {[...profile.availability]
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute)
                .map(
                  (w) =>
                    `${weekday(w.dayOfWeek, locale)} ${minutes(w.startMinute)}–${minutes(w.endMinute)}`,
                )
                .join(', ')}
            </span>
          </li>
        )}
      </ul>
    </article>
  );
}
