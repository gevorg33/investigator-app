import { formatDateTime, formatRelativeTime, type Locale } from '@investigator/i18n';
import { Monitor } from 'lucide-react';
import { getT } from '@/i18n/server';
import { serverApi, type Account } from '@/lib/api/server';
import type { SessionSummary } from '@/lib/api/types';
import { describeDevice } from '@/lib/device';
import { EndSession } from './session-actions';
import { AccountSection } from './section';

/**
 * Every device signed in to this account, this one first, each with a way to end it (T-005). Times
 * are in the account's own time zone. The IP address is not shown: a device and a time are what a
 * person recognises, and an address is one more personal detail on a screen.
 */
export async function SessionsSection({ account, locale }: { account: Account; locale: Locale }) {
  const t = await getT();
  const { sessions } = (await serverApi<{ sessions: SessionSummary[] }>('/auth/sessions')) ?? {
    sessions: [],
  };
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current));
  const now = new Date();
  return (
    <AccountSection id="sessions" title={t('account.sessions.title')}>
      <ul className="grid gap-3">
        {ordered.map((s) => {
          const device = describeDevice(s.userAgent);
          return (
            <li
              key={s.id}
              className="grid gap-3 rounded-md border border-border p-4 sm:flex sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <Monitor aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />
                <div className="grid gap-0.5 text-sm">
                  <p className="font-medium">
                    {device === null
                      ? t('account.sessions.unknown_device')
                      : t('account.sessions.device', device)}
                    {s.current && (
                      <span className="ml-2 font-semibold text-primary">
                        · {t('account.sessions.this_device')}
                      </span>
                    )}
                  </p>
                  <p className="text-text-muted">
                    {t('account.sessions.last_used', {
                      when: formatRelativeTime(s.lastUsedAt, now, locale),
                    })}
                  </p>
                  <p className="text-text-muted">
                    {t('account.sessions.signed_in', {
                      date: formatDateTime(s.createdAt, { locale, timeZone: account.timezone }),
                    })}
                  </p>
                </div>
              </div>
              <EndSession id={s.id} current={s.current} />
            </li>
          );
        })}
      </ul>
    </AccountSection>
  );
}
