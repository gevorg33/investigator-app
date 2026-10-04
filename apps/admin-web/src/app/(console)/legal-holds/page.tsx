import { Inbox, ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlaceHoldForm } from '@/components/legal-holds/place-hold-form';
import { ReleaseHoldForm } from '@/components/legal-holds/release-hold-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Notice } from '@/components/verification/notice';
import { t } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { getAccount, serverApi } from '@/lib/api/server';
import type { LegalHoldPage, LegalHoldResource, LegalHoldStatus } from '@/lib/api/types';
import { shortId, when } from '@/lib/format';
import { RESOURCES } from '@/lib/legal-holds';

export const metadata: Metadata = { title: t('holds.title') };

const STATUSES: readonly LegalHoldStatus[] = ['ACTIVE', 'RELEASED', 'ALL'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface View {
  status: LegalHoldStatus;
  record?: { type: LegalHoldResource; id: string } | undefined;
  cursor?: string | undefined;
}

/** This page's address for a view: the default status and no record leave the query out. */
const href = ({ status, record, cursor }: View): string => {
  const q = new URLSearchParams();
  if (status !== 'ACTIVE') q.set('status', status);
  if (record !== undefined) {
    q.set('resourceType', record.type);
    q.set('resourceId', record.id);
  }
  if (cursor !== undefined) q.set('cursor', cursor);
  const s = q.toString();
  return s === '' ? '/legal-holds' : `/legal-holds?${s}`;
};

/**
 * Legal holds (T-205, on T-035's API): what retention must not delete, and why. Holds in force
 * first — the usual question is what is held now — then released or all by a link; or the holds on
 * one record, looked up by its kind and id, which is how "is this account held?" is answered.
 * A card per hold on every width: the record, why it is held, who placed it and when, and — once
 * released — who released it and why. A hold in force is released from its card, through a sheet
 * that says it cannot be undone. Placing one is a sheet too, filled in with the record looked up.
 *
 * Every member of staff sees the link; only COMPLIANCE gets past the API, and the page says so in
 * words to anyone else (the console's pattern, admin-web.md). There is no page per hold: the API
 * reads holds as a list, and a card holds everything a hold says.
 */
export default async function LegalHoldsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    resourceType?: string;
    resourceId?: string;
    cursor?: string;
  }>;
}) {
  const params = await searchParams;
  // Anything but a status the API offers is the default, not an error.
  const status = STATUSES.find((s) => s === params.status) ?? 'ACTIVE';
  const typed = (params.resourceType ?? '') !== '' || (params.resourceId ?? '').trim() !== '';
  const type = RESOURCES.find((r) => r === params.resourceType);
  const id = (params.resourceId ?? '').trim();
  const record = type !== undefined && UUID.test(id) ? { type, id: id.toLowerCase() } : undefined;
  // A lookup that names no record is said so, and the list is not narrowed by half of one.
  const lookupInvalid = typed && record === undefined;
  const cursor = params.cursor;

  let page: LegalHoldPage;
  try {
    const q = new URLSearchParams({ status });
    if (record !== undefined) {
      q.set('resourceType', record.type);
      q.set('resourceId', record.id);
    }
    if (cursor !== undefined) q.set('cursor', cursor);
    page = (await serverApi<LegalHoldPage>(`/legal-holds?${q.toString()}`))!;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 403) {
      return (
        <Notice icon={ShieldX} title={t('holds.no_scope.title')} body={t('holds.no_scope.body')} />
      );
    }
    // A cursor that no longer fits: start again from the newest, in the same view.
    if (e.code === 'VALIDATION_FAILED' && cursor !== undefined) redirect(href({ status, record }));
    throw e;
  }
  const tz = (await getAccount())!.timezone;
  const label = (r: LegalHoldResource) => t(`holds.resource.${r}`);

  return (
    <section aria-labelledby="holds-title" className="grid gap-6">
      <div className="grid gap-3">
        <h1 id="holds-title" className="text-2xl font-semibold">
          {t('holds.title')}
        </h1>
        <p className="text-text-muted">{t('holds.intro')}</p>
        <PlaceHoldForm resourceType={record?.type} resourceId={record?.id} />
      </div>

      <form
        action="/legal-holds"
        aria-labelledby="find-title"
        className="grid gap-3 rounded-lg border border-border p-4 md:flex md:flex-wrap md:items-end"
      >
        <h2 id="find-title" className="text-base font-semibold md:basis-full">
          {t('holds.find.title')}
        </h2>
        {status !== 'ACTIVE' && <input type="hidden" name="status" value={status} />}
        <div className="grid gap-1.5 md:flex-none">
          <label htmlFor="find-type" className="text-sm font-medium">
            {t('holds.find.type')}
          </label>
          <NativeSelect id="find-type" name="resourceType" defaultValue={type ?? ''}>
            <option value="" />
            {RESOURCES.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5 md:flex-1">
          <label htmlFor="find-id" className="text-sm font-medium">
            {t('holds.find.id')}
          </label>
          <Input
            id="find-id"
            name="resourceId"
            defaultValue={params.resourceId ?? ''}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={lookupInvalid || undefined}
            aria-describedby={lookupInvalid ? 'find-invalid' : undefined}
            className="font-mono"
          />
        </div>
        {/* On a phone, after the message about the id, so it sits under the field it describes. */}
        <Button type="submit" variant="outline" className="order-last md:order-none">
          {t('holds.find.submit')}
        </Button>
        {lookupInvalid && (
          <p id="find-invalid" className="text-sm text-danger md:basis-full">
            {t('holds.find.invalid')}
          </p>
        )}
      </form>

      <nav aria-label={t('holds.status.label')} className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={href({ status: s, record })}
            aria-current={s === status ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded-md border border-border-control px-3 text-sm hover:bg-surface-sunken aria-[current=page]:border-primary aria-[current=page]:bg-primary-subtle aria-[current=page]:font-semibold aria-[current=page]:text-primary"
          >
            {t(`holds.status.${s}`)}
          </Link>
        ))}
      </nav>

      {record !== undefined && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="break-all">
            {t('holds.find.showing', { type: label(record.type), id: record.id })}
          </p>
          <Link
            href={href({ status })}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          >
            {t('holds.find.clear')}
          </Link>
        </div>
      )}

      {page.items.length === 0 ? (
        <Notice
          icon={Inbox}
          title={t('holds.empty.title')}
          body={record === undefined ? t(`holds.empty.body.${status}`) : t('holds.empty.record')}
        />
      ) : (
        <ul className="grid gap-3">
          {page.items.map((hold) => (
            <li key={hold.id}>
              <Card>
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={hold.release === null ? 'secondary' : 'outline'}>
                      {t(hold.release === null ? 'holds.item.in_force' : 'holds.item.released')}
                    </Badge>
                  </div>
                  <CardTitle className="grid gap-1">
                    <span>{label(hold.resourceType)}</span>
                    <span className="font-mono text-sm font-normal break-all text-text-muted">
                      {hold.resourceId}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-1">
                    <p className="text-sm text-text-muted">{t('holds.item.reason')}</p>
                    <p className="break-words whitespace-pre-wrap">{hold.reason}</p>
                  </div>
                  <p className="text-sm text-text-muted">
                    {t('holds.item.placed', {
                      date: when(hold.placedAt, tz),
                      by: shortId(hold.placedBy),
                    })}
                  </p>
                  {hold.release === null ? (
                    <ReleaseHoldForm
                      holdId={hold.id}
                      label={`${t('hold.release.open')} — ${label(hold.resourceType)} ${shortId(hold.resourceId)}`}
                    />
                  ) : (
                    <div className="grid gap-1 rounded-md bg-surface-sunken p-3">
                      <p className="text-sm text-text-muted">
                        {t('holds.item.released_on', {
                          date: when(hold.release.at, tz),
                          by: shortId(hold.release.by),
                        })}
                      </p>
                      <p className="text-sm text-text-muted">{t('holds.item.release_reason')}</p>
                      <p className="break-words whitespace-pre-wrap">{hold.release.reason}</p>
                    </div>
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
              <Link href={href({ status, record })}>{t('holds.first')}</Link>
            </Button>
          )}
          {page.pageInfo.nextCursor !== null && (
            <Button asChild variant="outline" className="sm:ml-auto">
              <Link href={href({ status, record, cursor: page.pageInfo.nextCursor })}>
                {t('holds.next')}
              </Link>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
