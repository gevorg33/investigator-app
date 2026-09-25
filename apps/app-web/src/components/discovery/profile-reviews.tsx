'use client';

import { formatDateTime, type Locale } from '@investigator/i18n';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';
import type { ProfileReviews as Reviews, PublicReview } from '@/lib/api/types';

/** A rating as five stars, filled up to it, read aloud as "4 out of 5". */
function Stars({ rating }: { rating: number }) {
  const t = useTranslations('missions.profile');
  return (
    <span role="img" aria-label={t('rating', { rating })} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={
            n <= rating ? 'size-4 fill-primary text-primary' : 'size-4 text-border-control'
          }
        />
      ))}
    </span>
  );
}

/**
 * An investigator's reviews (T-120, on T-037's API): the summary over every standing review, then
 * the reviews newest first — the rating, the published words, and the investigator's reply. No
 * reviewer is named; the API never sends one.
 */
export function ProfileReviews({ profileId, initial }: { profileId: string; initial: Reviews }) {
  const t = useTranslations('missions.profile');
  const locale = useLocale() as Locale;
  const [items, setItems] = useState<PublicReview[]>(initial.items);
  const [next, setNext] = useState(initial.pageInfo.nextCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { count, average } = initial.summary;

  const more = async () => {
    setPending(true);
    setError(null);
    try {
      const page = (await callApi<Reviews>(
        `/profiles/investigator/${encodeURIComponent(profileId)}/reviews?cursor=${encodeURIComponent(next!)}`,
        { method: 'GET' },
      ))!;
      setItems((all) => [...all, ...page.items]);
      setNext(page.pageInfo.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="reviews-title" className="mt-8 grid gap-4">
      <div className="grid gap-1">
        <h2 id="reviews-title" className="text-xl font-semibold">
          {t('reviews')}
        </h2>
        <p className="text-sm text-text-muted">
          {count === 0 || average === null
            ? t('none')
            : t('summary', {
                average: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                  average,
                ),
                count,
              })}
        </p>
      </div>
      {items.length > 0 && (
        <ul className="grid gap-3">
          {items.map((r) => (
            <li key={r.id} className="grid gap-2 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars rating={r.rating} />
                <span className="text-sm text-text-muted">
                  {formatDateTime(r.createdAt, { locale, timeZone: 'UTC', style: 'date' })}
                </span>
              </div>
              {r.text !== null && <p className="text-sm whitespace-pre-line">{r.text}</p>}
              <p className="text-xs text-text-muted">{t('by')}</p>
              {r.response !== null && (
                <div className="grid gap-1 border-l-2 border-border pl-3">
                  <p className="text-xs font-medium">{t('response')}</p>
                  <p className="text-sm whitespace-pre-line">{r.response}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError error={error} />
      {next !== null && (
        <Button
          variant="outline"
          onClick={() => void more()}
          disabled={pending}
          aria-busy={pending}
        >
          {t('more')}
        </Button>
      )}
    </section>
  );
}
