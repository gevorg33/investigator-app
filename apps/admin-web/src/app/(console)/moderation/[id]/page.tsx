import { formatMoneyRange } from '@investigator/i18n';
import { ArrowLeft, Bot, ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { BandBadge } from '@/components/moderation/band-badge';
import { ModerationForm } from '@/components/moderation/moderation-form';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/verification/notice';
import { LOCALE, t, type MessageKey } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { getAccount, serverApi } from '@/lib/api/server';
import type { ModerationReviewView } from '@/lib/api/types';
import { ago, shortId, when } from '@/lib/format';
import { taxonomyLabels } from '@/lib/taxonomy';

type Params = Promise<{ id: string }>;

/** The mission, or the refusal that stands in for it. Read once per request. */
const read = cache(async (id: string): Promise<ModerationReviewView | 'no_scope'> => {
  try {
    return (await serverApi<ModerationReviewView>(
      `/moderation/missions/${encodeURIComponent(id)}`,
    ))!;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 403) return 'no_scope';
    // Unknown, never submitted, or not an id at all (a malformed one is refused as 400).
    if (e.status === 404 || e.status === 400) notFound();
    throw e;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const view = await read((await params).id);
  return {
    title: view === 'no_scope' ? t('moderation.title') : (view.title ?? t('moderation.untitled')),
  };
}

const STATUSES = new Set(['UNDER_REVIEW', 'QUOTED', 'REJECTED', 'DRAFT']);

/**
 * One mission under review (T-051): the brief as the customer submitted it — not who they are,
 * which is not what is decided — the screening that sorted it, any AI classification set apart and
 * labelled as input, every decision on its earlier submissions, and the decision itself. A
 * moderator does not decide their own mission; the page says so rather than offering a form the
 * API would refuse. Attachments arrive with T-066.
 */
export default async function MissionReviewPage({ params }: { params: Params }) {
  const { id } = await params;
  const [view, account] = await Promise.all([read(id), getAccount()]);
  if (view === 'no_scope') {
    return (
      <Notice
        icon={ShieldX}
        title={t('moderation.no_scope.title')}
        body={t('moderation.no_scope.body')}
      />
    );
  }
  const names = await taxonomyLabels();
  const tz = account!.timezone;
  const now = new Date();
  const regions = new Intl.DisplayNames([LOCALE], { type: 'region' });
  const languages = new Intl.DisplayNames([LOCALE], { type: 'language' });
  const none = <span className="text-text-muted">{t('mission.brief.none')}</span>;
  const screening = view.screening;

  const brief: Array<[MessageKey, React.ReactNode]> = [
    [
      'mission.brief.category',
      view.taxonomyNodeId === null
        ? none
        : (names.get(view.taxonomyNodeId) ??
          t('mission.brief.category_unlisted', { id: shortId(view.taxonomyNodeId) })),
    ],
    [
      'mission.brief.place',
      view.countryCode === null
        ? none
        : [view.locationLabel, regions.of(view.countryCode)].filter((p) => p !== null).join(', '),
    ],
    [
      'mission.brief.languages',
      view.languages.length === 0
        ? none
        : view.languages.map((code) => languages.of(code)!).join(', '),
    ],
    [
      'mission.brief.timing',
      view.deadline === null
        ? none
        : view.startBy === null
          ? t('mission.brief.deadline_value', { deadline: view.deadline })
          : t('mission.brief.timing_value', { start: view.startBy, deadline: view.deadline }),
    ],
    [
      'mission.brief.budget',
      view.budgetMinMinor === null || view.budgetMaxMinor === null || view.currency === null
        ? none
        : formatMoneyRange(view.budgetMinMinor, view.budgetMaxMinor, view.currency, LOCALE),
    ],
    [
      'mission.brief.relationship',
      view.subjectRelationship === null
        ? none
        : t(`mission.relationship.${view.subjectRelationship}` as MessageKey),
    ],
    [
      'mission.brief.protective_order',
      view.protectiveOrderDeclared === null
        ? none
        : t(
            view.protectiveOrderDeclared
              ? 'mission.brief.protective_order.yes'
              : 'mission.brief.protective_order.no',
          ),
    ],
  ];

  return (
    <article aria-labelledby="mission-title" className="grid gap-8">
      <div className="grid gap-3">
        <Link
          href="/moderation"
          className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('mission.back')}
        </Link>
        <h1 id="mission-title" className="text-2xl font-semibold break-words">
          {view.title ?? t('moderation.untitled')}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant={view.status === 'UNDER_REVIEW' ? 'secondary' : 'outline'}>
            {t(
              STATUSES.has(view.status)
                ? (`mission.status.${view.status}` as MessageKey)
                : 'mission.status.other',
            )}
          </Badge>
          {screening !== null && <BandBadge band={screening.riskBand} />}
        </div>
        {view.queuedAt !== null && (
          <p className="text-sm text-text-muted">
            {t('mission.queued', { date: when(view.queuedAt, tz), ago: ago(view.queuedAt, now) })}
          </p>
        )}
      </div>

      <section aria-labelledby="brief" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="brief" className="text-lg font-semibold">
            {t('mission.brief.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('mission.brief.note')}</p>
        </div>
        <dl className="grid gap-3">
          <div className="grid gap-1">
            <dt className="font-medium">{t('mission.brief.description')}</dt>
            <dd className="break-words whitespace-pre-wrap">{view.description ?? none}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-medium">{t('mission.brief.purpose')}</dt>
            <dd className="break-words whitespace-pre-wrap">{view.purpose ?? none}</dd>
          </div>
          {brief.map(([label, value]) => (
            <div key={label} className="grid gap-1">
              <dt className="font-medium">{t(label)}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="screening" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="screening" className="text-lg font-semibold">
            {t('mission.screening.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('mission.screening.note')}</p>
        </div>
        {screening === null ? (
          <Alert>
            <ShieldX aria-hidden />
            <AlertContent>
              <AlertTitle>{t('mission.screening.missing')}</AlertTitle>
            </AlertContent>
          </Alert>
        ) : (
          <dl className="grid gap-3">
            <div className="grid gap-1">
              <dt className="font-medium">{t('mission.screening.band')}</dt>
              <dd>{t(`moderation.band.${screening.riskBand}`)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">{t('mission.screening.outcome')}</dt>
              <dd>{t(`moderation.screening_outcome.${screening.outcome}`)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">{t('mission.screening.flags')}</dt>
              <dd>
                {screening.flags.length === 0 ? (
                  t('mission.screening.no_flags')
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {screening.flags.map((flag) => (
                      <li key={flag}>
                        <Badge variant="outline" className="font-mono">
                          {flag}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <p className="text-sm text-text-muted">
              {t('mission.screening.ruleset', {
                version: screening.rulesetVersion,
                date: when(screening.screenedAt, tz),
              })}
            </p>
          </dl>
        )}
      </section>

      <section
        aria-labelledby="ai"
        className="grid gap-3 rounded-lg border border-dashed border-border p-4"
      >
        <div className="grid gap-1">
          <h2 id="ai" className="inline-flex items-center gap-2 text-lg font-semibold">
            <Bot aria-hidden className="size-5" />
            {t('mission.ai.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('mission.ai.note')}</p>
        </div>
        {screening === null || screening.aiClassification === null ? (
          <p className="text-text-muted">{t('mission.ai.none')}</p>
        ) : (
          <pre className="overflow-x-auto rounded-md bg-surface-sunken p-3 text-sm">
            {JSON.stringify(screening.aiClassification, null, 2)}
          </pre>
        )}
      </section>

      <section aria-labelledby="decision" className="grid gap-3">
        <h2 id="decision" className="text-lg font-semibold">
          {t('moderate.title')}
        </h2>
        {view.party ? (
          <Alert>
            <ShieldX aria-hidden />
            <AlertContent>
              <AlertTitle>{t('mission.party')}</AlertTitle>
            </AlertContent>
          </Alert>
        ) : view.status === 'UNDER_REVIEW' && screening !== null ? (
          <ModerationForm missionId={view.id} version={view.version} />
        ) : view.status === 'UNDER_REVIEW' ? null : (
          <p className="text-text-muted">{t('mission.decided')}</p>
        )}
      </section>

      <section aria-labelledby="decisions" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="decisions" className="text-lg font-semibold">
            {t('mission.decisions.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('mission.decisions.note')}</p>
        </div>
        {view.decisions.length === 0 ? (
          <p className="text-text-muted">{t('mission.decisions.none')}</p>
        ) : (
          <ol className="grid gap-3">
            {view.decisions.map((d) => (
              <li
                key={`${d.missionVersion}-${d.decidedAt}`}
                className="grid gap-2 rounded-lg border border-border p-3"
              >
                <p className="font-medium">
                  {t('mission.decisions.entry', {
                    outcome: t(`mission.outcome.${d.outcome}`),
                    date: when(d.decidedAt, tz),
                    by: shortId(d.decidedBy),
                  })}
                </p>
                <div className="grid gap-1">
                  <p className="text-sm text-text-muted">
                    {t(
                      d.outcome === 'PUBLISHED'
                        ? 'mission.decisions.reason'
                        : 'mission.decisions.customer_read',
                    )}
                  </p>
                  <p className="break-words whitespace-pre-wrap">{d.reason}</p>
                </div>
                {d.internalNote !== null && (
                  <div className="grid gap-1">
                    <p className="text-sm text-text-muted">
                      {t('mission.decisions.internal_note')}
                    </p>
                    <p className="break-words whitespace-pre-wrap">{d.internalNote}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
