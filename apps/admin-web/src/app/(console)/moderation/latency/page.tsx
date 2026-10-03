import { ArrowLeft, Inbox, ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BandBadge } from '@/components/moderation/band-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/verification/notice';
import { t, type MessageKey } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type { LatencyReport } from '@/lib/api/types';
import { duration, shortId } from '@/lib/format';
import { taxonomyLabels } from '@/lib/taxonomy';

export const metadata: Metadata = { title: t('latency.title') };

const PERIODS = ['30', '90', '365'] as const;

/**
 * Review times (T-193): how long customers waited for a moderator's decision, and what was decided,
 * per category and risk band — the data any decision to open the gate for a category would rest on
 * (plan §10, T-191), which this page says, and that nothing opens from it. Aggregates only: no
 * mission, customer or moderator. A card per category and band on every width, as the queues are.
 */
export default async function LatencyPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  // Anything but a period the API offers is the default, not an error.
  const period = PERIODS.find((p) => p === days);
  let report: LatencyReport;
  try {
    report = (await serverApi<LatencyReport>(
      `/moderation/missions/latency${period === undefined ? '' : `?days=${period}`}`,
    ))!;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return (
        <Notice
          icon={ShieldX}
          title={t('moderation.no_scope.title')}
          body={t('moderation.no_scope.body')}
        />
      );
    }
    throw e;
  }
  const names = report.rows.length === 0 ? new Map<string, string>() : await taxonomyLabels();

  return (
    <section aria-labelledby="latency-title" className="grid gap-6">
      <div className="grid gap-3">
        <Link
          href="/moderation"
          className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('latency.back')}
        </Link>
        <h1 id="latency-title" className="text-2xl font-semibold">
          {t('latency.title')}
        </h1>
        <p className="text-text-muted">{t('latency.intro')}</p>
        <p className="text-sm text-text-muted">{t('latency.purpose')}</p>
      </div>

      <nav aria-label={t('latency.period.label')} className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={p === '90' ? '/moderation/latency' : `/moderation/latency?days=${p}`}
            aria-current={String(report.days) === p ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded-md border border-border-control px-3 text-sm hover:bg-surface-sunken aria-[current=page]:border-primary aria-[current=page]:bg-primary-subtle aria-[current=page]:font-semibold aria-[current=page]:text-primary"
          >
            {t(`latency.period.${p}` as MessageKey)}
          </Link>
        ))}
      </nav>

      {report.rows.length === 0 ? (
        <Notice icon={Inbox} title={t('latency.empty.title')} body={t('latency.empty.body')} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {report.rows.map((row) => (
            <li key={`${row.taxonomyNodeId}-${row.riskBand}`}>
              <Card className="h-full">
                <CardHeader className="gap-2">
                  <BandBadge band={row.riskBand} />
                  <CardTitle className="break-words">
                    {row.taxonomyNodeId === null
                      ? t('latency.uncategorised')
                      : (names.get(row.taxonomyNodeId) ??
                        t('mission.brief.category_unlisted', { id: shortId(row.taxonomyNodeId) }))}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {(
                      [
                        ['latency.decided', String(row.decided)],
                        ['latency.median', duration(row.medianMs)],
                        ['latency.p90', duration(row.p90Ms)],
                        ['latency.longest', duration(row.longestMs)],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="grid gap-0.5">
                        <dt className="text-text-muted">{t(label)}</dt>
                        <dd className="font-medium">{value}</dd>
                      </div>
                    ))}
                    <div className="col-span-2 grid gap-0.5">
                      <dt className="text-text-muted">{t('latency.outcomes')}</dt>
                      <dd>
                        {t('latency.outcomes_value', {
                          published: row.outcomes.published,
                          changes: row.outcomes.changesRequested,
                          rejected: row.outcomes.rejected,
                        })}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
