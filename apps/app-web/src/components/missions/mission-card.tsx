import {
  formatDateTime,
  formatMoneyRange,
  formatRelativeTime,
  type Locale,
} from '@investigator/i18n';
import { CalendarClock, Languages, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/i18n/server';
import type { MissionListing } from '@/lib/api/types';

/** A deadline this close is flagged, in words as well as colour. */
const SOON_DAYS = 7;

/** Whole days from today (UTC) to a calendar date. */
const daysUntil = (date: string, now: Date) =>
  Math.round(
    (Date.parse(`${date}T00:00:00Z`) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
      86_400_000,
  );

/**
 * One published mission in the browse (T-054), composed from `@shadcn/card`: the category and how
 * fresh it is, then the title and a two-line description, then where and in which languages, and
 * last what decides a quote — the budget and the deadline, with a close deadline flagged. Nothing
 * about the customer; the API does not send it.
 */
export async function MissionCard({
  mission,
  category,
  locale,
  now,
}: {
  mission: MissionListing;
  category: string | null;
  locale: Locale;
  now: Date;
}) {
  const t = await getT();
  // An unknown code is named by the code itself (DisplayNames' default fallback), never undefined.
  const languageNames = new Intl.DisplayNames([locale], { type: 'language' });
  const where = [
    mission.locationLabel,
    mission.distanceKm === null
      ? null
      : mission.distanceKm === 0
        ? t('missions.browse.card.inside')
        : t('missions.browse.card.distance', { km: mission.distanceKm }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const days = daysUntil(mission.deadline, now);

  const titleId = `mission-${mission.id}-title`;
  return (
    <article aria-labelledby={titleId}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            {category === null ? <span /> : <Badge variant="secondary">{category}</Badge>}
            <p className="shrink-0 text-xs text-text-muted">
              {t('missions.browse.card.posted', {
                when: formatRelativeTime(mission.publishedAt, now, locale),
              })}
            </p>
          </div>
          <CardTitle id={titleId}>{mission.title}</CardTitle>
          <p className="line-clamp-2 text-sm text-text-muted">{mission.description}</p>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm">
            {where !== '' && (
              <li className="flex items-center gap-2">
                <MapPin aria-hidden className="size-4 shrink-0 text-text-muted" />
                {where}
              </li>
            )}
            <li className="flex items-center gap-2">
              <Languages aria-hidden className="size-4 shrink-0 text-text-muted" />
              {t('missions.browse.card.languages', {
                languages: new Intl.ListFormat([locale], { type: 'conjunction' }).format(
                  mission.languages.map((l) => languageNames.of(l)!),
                ),
              })}
            </li>
          </ul>
        </CardContent>
        <CardFooter className="justify-between">
          <div className="grid">
            <span className="text-xs text-text-muted">
              {t('missions.browse.card.budget_label')}
            </span>
            <span className="text-base font-semibold">
              {formatMoneyRange(
                mission.budgetMinMinor,
                mission.budgetMaxMinor,
                mission.currency,
                locale,
              )}
            </span>
          </div>
          {days <= SOON_DAYS ? (
            <Badge variant="warning">
              <CalendarClock aria-hidden />
              {t('missions.browse.card.due_in', { days: Math.max(days, 0) })}
            </Badge>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-text-muted">
              <CalendarClock aria-hidden className="size-4" />
              {t('missions.browse.card.due', {
                // A deadline is a calendar date, not an instant: formatted in UTC so it never shifts.
                date: formatDateTime(mission.deadline, { locale, timeZone: 'UTC', style: 'date' }),
              })}
            </span>
          )}
        </CardFooter>
      </Card>
    </article>
  );
}
