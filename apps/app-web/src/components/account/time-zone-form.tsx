'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { deviceTimeZone } from '@/lib/navigate';

/**
 * The account's time zone (T-127): every date is formatted in it (`formatDateTime` requires one).
 * Offered first is the device's own zone, read in the browser after it loads — the server cannot
 * know it, and reading it during render would disagree with the server's HTML. Any zone the
 * browser knows can be chosen from the list.
 */
export function TimeZoneForm({ current }: { current: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [detected, setDetected] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDetected(deviceTimeZone()), []);
  const zones = useMemo(() => {
    const known = Intl.supportedValuesOf('timeZone');
    return known.includes(current) ? known : [current, ...known];
  }, [current]);
  const { pending, error, onSubmit } = useSubmit(
    (form) =>
      callApi('/me/preferences', { method: 'PATCH', body: { timezone: form.get('timezone') } }),
    () => {
      setSaved(true);
      router.refresh();
    },
  );
  return (
    <div className="grid gap-4">
      <p className="text-sm">{t('account.timezone.current', { zone: current })}</p>
      <FormError
        error={error}
        overrides={{ VALIDATION_FAILED: 'error.validation.timezone.invalid' }}
      />
      {saved && (
        <p role="status" className="text-sm">
          {t('account.timezone.saved')}
        </p>
      )}
      {detected !== undefined && detected !== current && (
        <form onSubmit={onSubmit} className="grid gap-2">
          <p className="text-sm text-text-muted">
            {t('account.timezone.detected', { zone: detected })}
          </p>
          <input type="hidden" name="timezone" value={detected} />
          <Button type="submit" disabled={pending}>
            {t('account.timezone.use_detected', { zone: detected })}
          </Button>
        </form>
      )}
      <form onSubmit={onSubmit} className="grid gap-2 sm:flex sm:items-end">
        <label className="grid flex-1 gap-1.5 text-sm font-medium">
          {t('account.timezone.choose')}
          <select
            name="timezone"
            defaultValue={current}
            className="min-h-11 rounded-md border border-input bg-surface-raised px-3 text-base"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" disabled={pending}>
          {t('account.timezone.save')}
        </Button>
      </form>
    </div>
  );
}
