import { FileCheck2, Inbox, ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/verification/notice';
import { t } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { getAccount, serverApi } from '@/lib/api/server';
import type { QueuePage } from '@/lib/api/types';
import { shortId, when } from '@/lib/format';

export const metadata: Metadata = { title: t('verification.title') };

/**
 * The verification queue (T-070): applications waiting for a decision, oldest first, a page at a
 * time — a list of cards on every width, since each is something to open and act on
 * (responsive-design). Who may read it is the API's decision: without the VERIFICATION scope it
 * refuses, and this says what is missing rather than showing an empty queue.
 */
export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const account = (await getAccount())!;
  let page: QueuePage;
  try {
    page = (await serverApi<QueuePage>(
      `/verification/requests${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
    ))!;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 403) {
      return (
        <Notice
          icon={ShieldX}
          title={t('verification.no_scope.title')}
          body={t('verification.no_scope.body')}
        />
      );
    }
    // A cursor from a queue that has moved on: start again from the oldest.
    if (e.status === 422 && cursor !== undefined) redirect('/verification');
    throw e;
  }

  return (
    <section aria-labelledby="queue-title" className="grid gap-6">
      <div className="grid gap-1">
        <h1 id="queue-title" className="text-2xl font-semibold">
          {t('verification.title')}
        </h1>
        <p className="text-text-muted">{t('verification.intro')}</p>
      </div>

      {page.items.length === 0 ? (
        <Notice
          icon={Inbox}
          title={t('verification.empty.title')}
          body={t('verification.empty.body')}
        />
      ) : (
        <ul className="grid gap-3">
          {page.items.map((item) => (
            <li key={item.id}>
              <Card className="relative hover:bg-surface-sunken">
                <CardHeader>
                  <CardTitle>
                    {/* The whole card opens it; the link is the title, for its name. */}
                    <Link href={`/verification/${item.id}`} className="after:absolute after:inset-0">
                      {t('verification.item.title', { date: when(item.submittedAt, account.timezone) })}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <FileCheck2 aria-hidden className="size-4" />
                    {t('verification.item.documents', { count: item.documentCount })}
                  </span>
                  <span>{t('verification.item.profile', { id: shortId(item.profileId) })}</span>
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
              <Link href="/verification">{t('verification.first')}</Link>
            </Button>
          )}
          {page.pageInfo.nextCursor !== null && (
            <Button asChild variant="outline" className="sm:ml-auto">
              <Link href={`/verification?cursor=${encodeURIComponent(page.pageInfo.nextCursor)}`}>
                {t('verification.next')}
              </Link>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
