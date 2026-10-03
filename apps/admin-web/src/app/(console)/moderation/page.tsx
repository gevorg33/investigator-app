import { CalendarClock, Flag, Inbox, ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BandBadge } from '@/components/moderation/band-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/verification/notice';
import { t } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type { ModerationQueuePage } from '@/lib/api/types';
import { ago } from '@/lib/format';
import { taxonomyLabels } from '@/lib/taxonomy';

export const metadata: Metadata = { title: t('moderation.title') };

/**
 * The moderation queue (T-051): missions under review, the most sensitive risk band first, then
 * whoever has waited longest — a list of cards on every width, each something to open and decide
 * (responsive-design). How long each has waited is on its card: an unreviewed mission is a customer
 * waiting, and one past its deadline is no use to them. Who may read it is the API's decision.
 */
export default async function ModerationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  let page: ModerationQueuePage;
  try {
    page = (await serverApi<ModerationQueuePage>(
      `/moderation/missions${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
    ))!;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 403) {
      return (
        <Notice
          icon={ShieldX}
          title={t('moderation.no_scope.title')}
          body={t('moderation.no_scope.body')}
        />
      );
    }
    // A cursor from a queue that has moved on: start again from the top.
    if (e.status === 422 && cursor !== undefined) redirect('/moderation');
    throw e;
  }
  const names = page.items.length === 0 ? new Map<string, string>() : await taxonomyLabels();
  const now = new Date();

  return (
    <section aria-labelledby="queue-title" className="grid gap-6">
      <div className="grid gap-1">
        <h1 id="queue-title" className="text-2xl font-semibold">
          {t('moderation.title')}
        </h1>
        <p className="text-text-muted">{t('moderation.intro')}</p>
      </div>

      {page.items.length === 0 ? (
        <Notice
          icon={Inbox}
          title={t('moderation.empty.title')}
          body={t('moderation.empty.body')}
        />
      ) : (
        <ul className="grid gap-3">
          {page.items.map((item) => (
            <li key={item.id}>
              <Card className="relative hover:bg-surface-sunken">
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap gap-2">
                    <BandBadge band={item.riskBand} />
                    <Badge variant="outline">
                      {t(`moderation.screening_outcome.${item.screeningOutcome}`)}
                    </Badge>
                  </div>
                  <CardTitle className="break-words">
                    {/* The whole card opens it; the link is the title, for its name. */}
                    <Link href={`/moderation/${item.id}`} className="after:absolute after:inset-0">
                      {item.title ?? t('moderation.untitled')}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                  <span>{t('moderation.item.queued', { ago: ago(item.queuedAt, now) })}</span>
                  {item.deadline !== null && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock aria-hidden className="size-4" />
                      {t('moderation.item.deadline', { date: item.deadline })}
                    </span>
                  )}
                  {item.flagCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Flag aria-hidden className="size-4" />
                      {t('moderation.item.flags', { count: item.flagCount })}
                    </span>
                  )}
                  {item.taxonomyNodeId !== null && names.has(item.taxonomyNodeId) && (
                    <span>{names.get(item.taxonomyNodeId)}</span>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {(cursor !== undefined || page.pageInfo.nextCursor !== null) && (
        <nav className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {cursor !== undefined && (
            <Button asChild variant="ghost">
              <Link href="/moderation">{t('moderation.first')}</Link>
            </Button>
          )}
          {page.pageInfo.nextCursor !== null && (
            <Button asChild variant="outline" className="sm:ml-auto">
              <Link href={`/moderation?cursor=${encodeURIComponent(page.pageInfo.nextCursor)}`}>
                {t('moderation.next')}
              </Link>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
