'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Switch } from '@/components/ui/switch';
import { callApi } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';
import type { NotificationPreference } from '@/lib/api/types';

/**
 * Activity emails on or off (T-169), saved as it is flipped. It shows the new position at once and
 * goes back if the API refuses, saying why; what the API answers is what it then shows.
 */
export function EmailSwitch({ enabled }: { enabled: boolean }) {
  const t = useTranslations('account.emails');
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const save = async (next: boolean) => {
    setOn(next);
    setBusy(true);
    setError(null);
    try {
      const res = await callApi<{ preferences: NotificationPreference[] }>(
        '/notifications/preferences',
        { method: 'PUT', body: { category: 'activity', channel: 'email', enabled: next } },
      );
      const saved = res?.preferences.find(
        (p) => p.category === 'activity' && p.channel === 'email',
      );
      if (saved !== undefined) setOn(saved.enabled);
    } catch (e) {
      setOn(!next);
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <label
        htmlFor="switch-email-activity"
        className="flex min-h-11 cursor-pointer items-center justify-between gap-4"
      >
        <span className="grid gap-0.5">
          <span id="switch-email-activity-label" className="font-medium">
            {t('activity')}
          </span>
          <span id="switch-email-activity-body" className="text-sm text-text-muted">
            {t('activity_body')}
          </span>
        </span>
        <Switch
          id="switch-email-activity"
          // Named by the title alone, described by the sentence under it: the label spans both so
          // the whole row is the target, and would otherwise make the sentence its name.
          aria-labelledby="switch-email-activity-label"
          aria-describedby="switch-email-activity-body"
          checked={on}
          disabled={busy}
          onCheckedChange={(next) => void save(next)}
        />
      </label>
      <FormError error={error} />
    </div>
  );
}
