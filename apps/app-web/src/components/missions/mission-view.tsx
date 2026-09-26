import { formatDateTime, type Locale } from '@investigator/i18n';
import { CircleCheck, CircleX, Hourglass, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { getT } from '@/i18n/server';
import type { OwnMission } from '@/lib/api/types';
import { Brief, type BriefNames } from './intake/brief';
import { POLICY_HREF } from './intake/steps';
import { CancelMission } from './cancel-mission';
import { ReviseMission } from './revise-mission';

/** What the customer is told about a sent mission, by where it stands. Others show the brief only. */
const EXPLAINED = {
  UNDER_REVIEW: { icon: Hourglass, key: 'review' },
  SUBMITTED: { icon: Hourglass, key: 'review' },
  QUOTED: { icon: CircleCheck, key: 'published' },
  CANCELLED: { icon: CircleX, key: 'cancelled' },
} as const satisfies Partial<Record<OwnMission['status'], { icon: LucideIcon; key: string }>>;

/**
 * A mission once sent (T-119): where it stands and what happens next, in plain words, then the
 * brief exactly as sent. A rejection gives the moderator's reason and the way on — a new mission
 * from this one — because a rejected mission itself cannot be reopened.
 */
export async function MissionView({
  mission,
  names,
  locale,
  timeZone,
}: {
  mission: OwnMission;
  names: BriefNames;
  locale: Locale;
  timeZone: string;
}) {
  const t = await getT();
  const explained =
    mission.status in EXPLAINED ? EXPLAINED[mission.status as keyof typeof EXPLAINED] : null;
  const rejected = mission.status === 'REJECTED';

  return (
    <div className="mt-4 grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={rejected ? 'warning' : 'secondary'}>
          {t(`missions.status.${mission.status}`)}
        </Badge>
        {mission.submittedAt !== null && (
          <span className="text-sm text-text-muted">
            {t('missions.view.sent', {
              date: formatDateTime(mission.submittedAt, { locale, timeZone, style: 'date' }),
            })}
          </span>
        )}
      </div>

      {explained !== null && (
        <Alert>
          <explained.icon aria-hidden />
          <AlertContent>
            <AlertTitle>{t(`missions.view.${explained.key}.title`)}</AlertTitle>
            <p>{t(`missions.view.${explained.key}.body`)}</p>
          </AlertContent>
        </Alert>
      )}

      {/* The one sent status the customer can still take back here; a published mission's quotes
          close with it, which belongs with the quotes screen (T-121). */}
      {mission.status === 'UNDER_REVIEW' && (
        <CancelMission mission={{ id: mission.id, version: mission.version }} stage="review" />
      )}

      {rejected && (
        <section aria-labelledby="rejected-title" className="grid gap-3">
          <Alert>
            <CircleX aria-hidden />
            <AlertContent>
              <AlertTitle>
                <span id="rejected-title">{t('missions.view.rejected.title')}</span>
              </AlertTitle>
              {mission.review?.reason ? (
                <>
                  <p>{t('missions.view.rejected.reason')}</p>
                  <blockquote className="mt-2 border-l-2 border-border-control pl-3 whitespace-pre-wrap">
                    {mission.review.reason}
                  </blockquote>
                </>
              ) : (
                <p>{t('missions.view.rejected.no_reason')}</p>
              )}
            </AlertContent>
          </Alert>
          <p>{t('missions.view.rejected.next')}</p>
          <ReviseMission
            fields={{
              taxonomyNodeId: mission.taxonomyNodeId,
              title: mission.title,
              description: mission.description,
              countryCode: mission.countryCode,
              locationLabel: mission.locationLabel,
              startBy: mission.startBy,
              deadline: mission.deadline,
              budgetMinMinor: mission.budgetMinMinor,
              budgetMaxMinor: mission.budgetMaxMinor,
              currency: mission.currency,
              languages: mission.languages,
              purpose: mission.purpose,
              subjectRelationship: mission.subjectRelationship,
              protectiveOrderDeclared: mission.protectiveOrderDeclared,
            }}
          />
          <Link href={POLICY_HREF} className="min-h-11 text-sm text-primary underline">
            {t('missions.intake.review.policy')}
          </Link>
        </section>
      )}

      <section aria-labelledby="brief-title" className="grid gap-3">
        <h2 id="brief-title" className="text-lg font-semibold">
          {t('missions.view.brief')}
        </h2>
        <Brief fields={mission} names={names} />
      </section>
    </div>
  );
}
