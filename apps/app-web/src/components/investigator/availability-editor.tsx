'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { callApi } from '@/lib/api/browser';
import type { AvailabilityWindow } from '@/lib/api/types';

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** "09:30" from minutes after midnight, and back. */
export const toClock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// A time input's value is "HH:MM" (or "HH:MM:SS"), or "" when cleared by hand — which is midnight.
export const fromClock = (clock: string) =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Weekday names for ISO 8601 day 0 (Monday) to 6, in the reader's language. */
const weekday = (day: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 1 + day)),
  );

/**
 * When an investigator usually works (T-123): a list of weekly windows — a day, a start, an end —
 * so a split day is two rows rather than something the editor cannot say. Saved as one set.
 */
export function AvailabilityEditor({ windows }: { windows: readonly AvailabilityWindow[] }) {
  const t = useTranslations('investigator.availability');
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<AvailabilityWindow[]>(
    [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute),
  );
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const { pending, error, onSubmit } = useSubmit(
    async () => {
      setSaved(false);
      if (rows.some((r) => r.endMinute <= r.startMinute)) {
        setInvalid(true);
        return false;
      }
      setInvalid(false);
      await callApi('/profiles/investigator/me', {
        method: 'PATCH',
        body: { availability: rows },
      });
      return true;
    },
    (ok) => {
      if (!ok) return;
      setSaved(true);
      router.refresh();
    },
  );
  const update = (i: number, patch: Partial<AvailabilityWindow>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError error={error} />
      {invalid && (
        <p role="alert" className="text-sm text-danger">
          {t('invalid')}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('off')}</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row, i) => (
            <li
              key={i}
              className="grid gap-2 rounded-md border border-border p-3 sm:flex sm:items-end"
            >
              <div className="flex items-end gap-2 sm:contents">
                <label className="grid flex-1 gap-1 text-sm font-medium">
                  {t('day')}
                  <NativeSelect
                    value={row.dayOfWeek}
                    onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {weekday(d, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:order-last"
                  aria-label={t('remove', {
                    day: weekday(row.dayOfWeek, locale),
                    from: toClock(row.startMinute),
                    to: toClock(row.endMinute),
                  })}
                  onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:contents">
                <label className="grid gap-1 text-sm font-medium">
                  {t('from')}
                  <Input
                    type="time"
                    value={toClock(row.startMinute)}
                    onChange={(e) => update(i, { startMinute: fromClock(e.target.value) })}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  {t('to')}
                  <Input
                    type="time"
                    value={toClock(row.endMinute === 1440 ? 1439 : row.endMinute)}
                    onChange={(e) => update(i, { endMinute: fromClock(e.target.value) })}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows((all) => [
              ...all,
              { dayOfWeek: all.length % 7, startMinute: 9 * 60, endMinute: 18 * 60 },
            ])
          }
        >
          <Plus aria-hidden />
          {t('add')}
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('save')}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-success">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  );
}
