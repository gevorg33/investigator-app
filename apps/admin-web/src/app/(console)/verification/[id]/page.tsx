import { ArrowLeft, ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { DecisionForm } from '@/components/verification/decision-form';
import { DocumentLink } from '@/components/verification/document-link';
import { Notice } from '@/components/verification/notice';
import { t, type MessageKey } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { getAccount, serverApi } from '@/lib/api/server';
import type { ReviewView, TaxonomyNode } from '@/lib/api/types';
import { fileSize, shortId, when } from '@/lib/format';

type Params = Promise<{ id: string }>;

/** The application, or the refusal that stands in for it. Read once per request. */
const read = cache(async (id: string): Promise<ReviewView | 'no_scope'> => {
  try {
    return (await serverApi<ReviewView>(`/verification/requests/${encodeURIComponent(id)}`))!;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 403) return 'no_scope';
    // Unknown, or not an application at all (a malformed id is refused as 400).
    if (e.status === 404 || e.status === 400) notFound();
    throw e;
  }
});

/** Every taxonomy node's label, by id — to name what was declared by id. */
async function labels(): Promise<Map<string, string>> {
  const tree = (await serverApi<TaxonomyNode[]>('/taxonomy?locale=en')) ?? [];
  const out = new Map<string, string>();
  const walk = (nodes: TaxonomyNode[]) => {
    for (const n of nodes) {
      out.set(n.id, n.label ?? n.slug);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const view = await read((await params).id);
  return {
    title:
      view === 'no_scope'
        ? t('verification.title')
        : t('review.title', { date: view.submittedAt.slice(0, 10) }),
  };
}

/**
 * One application (T-070): what was declared — **as recorded on the application**, never the
 * profile as it is now, which may have moved since — the documents, opened one at a time through
 * the audited link, every earlier decision, and the decision itself. Nobody decides their own
 * application; the page says so rather than offering a form the API would refuse.
 */
export default async function ReviewPage({ params }: { params: Params }) {
  const { id } = await params;
  const [view, account] = await Promise.all([read(id), getAccount()]);
  if (view === 'no_scope') {
    return (
      <Notice
        icon={ShieldX}
        title={t('verification.no_scope.title')}
        body={t('verification.no_scope.body')}
      />
    );
  }
  const names = await labels();
  const tz = account!.timezone;
  const own = view.profile.userId === account!.id;
  const declared = view.declaredScope;

  return (
    <article aria-labelledby="review-title" className="grid gap-8">
      <div className="grid gap-3">
        <Link
          href="/verification"
          className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('review.back')}
        </Link>
        <h1 id="review-title" className="text-2xl font-semibold">
          {t('review.title', { date: when(view.submittedAt, tz) })}
        </h1>
        <Badge variant={view.status === 'SUBMITTED' ? 'secondary' : 'outline'}>
          {t(`review.status.${view.status}`)}
        </Badge>
      </div>

      <section aria-labelledby="applicant" className="grid gap-1">
        <h2 id="applicant" className="text-lg font-semibold">
          {t('review.profile')}
        </h2>
        <p>{view.profile.headline ?? t('review.no_headline')}</p>
        <p className="text-sm text-text-muted">
          {shortId(view.profile.id)} ·{' '}
          {t('review.profile_status', { status: view.profile.verificationStatus })}
        </p>
      </section>

      <section aria-labelledby="declared" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="declared" className="text-lg font-semibold">
            {t('review.declared.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('review.declared.note')}</p>
        </div>
        <dl className="grid gap-3">
          <div className="grid gap-1">
            <dt className="font-medium">{t('review.declared.specialties')}</dt>
            {declared.specialtyNodeIds.length === 0 ? (
              <dd className="text-text-muted">{t('review.declared.none')}</dd>
            ) : (
              declared.specialtyNodeIds.map((nodeId) => (
                <dd key={nodeId}>
                  {names.get(nodeId) ?? t('review.declared.unlisted', { id: shortId(nodeId) })}
                </dd>
              ))
            )}
          </div>
          <div className="grid gap-1">
            <dt className="font-medium">{t('review.declared.areas')}</dt>
            {declared.serviceAreas.length === 0 ? (
              <dd className="text-text-muted">{t('review.declared.none')}</dd>
            ) : (
              declared.serviceAreas.map((a) => (
                <dd key={a.id}>
                  {[a.label, a.city, a.region, a.countryCode].filter((p) => p !== null).join(' · ')}
                </dd>
              ))
            )}
          </div>
        </dl>
      </section>

      <section aria-labelledby="documents" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="documents" className="text-lg font-semibold">
            {t('review.documents.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('review.documents.note')}</p>
        </div>
        <ol className="grid gap-4">
          {view.documents.map((d, i) => (
            <li key={d.mediaAssetId} className="grid gap-2 rounded-lg border border-border p-3">
              <p className="text-sm">
                {t('review.documents.kind', {
                  type: d.declaredMimeType,
                  size: d.bytes === null ? t('review.documents.unknown_size') : fileSize(d.bytes),
                })}
              </p>
              {d.scanStatus === 'CLEAN' ? (
                <DocumentLink requestId={view.id} assetId={d.mediaAssetId} n={i + 1} />
              ) : (
                <p className="text-sm text-warning">
                  {t(`review.documents.scan.${d.scanStatus}` as MessageKey)}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="decision" className="grid gap-3">
        <h2 id="decision" className="text-lg font-semibold">
          {t('decision.title')}
        </h2>
        {own ? (
          <Alert>
            <ShieldX aria-hidden />
            <AlertContent>
              <AlertTitle>{t('review.own')}</AlertTitle>
            </AlertContent>
          </Alert>
        ) : view.status === 'SUBMITTED' ? (
          <DecisionForm requestId={view.id} />
        ) : (
          <p className="text-text-muted">{t('review.decided')}</p>
        )}
      </section>

      <section aria-labelledby="trail" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="trail" className="text-lg font-semibold">
            {t('review.trail.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('review.trail.note')}</p>
        </div>
        <ol className="grid gap-3">
          {view.trail.map((entry) => (
            <li
              key={entry.requestId}
              aria-current={entry.requestId === view.id ? 'true' : undefined}
              className="grid gap-1 rounded-lg border border-border p-3 aria-[current=true]:border-primary"
            >
              <p className="text-sm text-text-muted">
                {t('review.trail.submitted', { date: when(entry.submittedAt, tz) })}
                {entry.requestId === view.id && <> · {t('review.trail.this')}</>}
              </p>
              {entry.decision === null ? (
                <p>{t('review.trail.waiting')}</p>
              ) : (
                <>
                  <p className="font-medium">
                    {t('review.trail.decided', {
                      outcome: t(`review.status.${entry.decision.outcome}`),
                      date: when(entry.decision.decidedAt, tz),
                      by: shortId(entry.decision.decidedBy),
                    })}
                  </p>
                  <p className="whitespace-pre-wrap">{entry.decision.reason}</p>
                </>
              )}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
