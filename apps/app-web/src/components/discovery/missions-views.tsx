import Link from 'next/link';
import { getT } from '@/i18n/server';
import type { Account } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { DISCOVERY_PATH } from './discovery-query';

/**
 * Whether Missions shows this reader the investigator's side — open missions to quote on (T-054)
 * — rather than the customer's: an investigator, unless they chose to see the platform as a
 * customer. The one reading both Missions pages make.
 */
export const actsAsInvestigator = (account: Account | null): boolean =>
  account !== null && account.roles.includes('INVESTIGATOR') && account.activeRole !== 'CUSTOMER';

/**
 * A customer's two views of Missions (T-120): their own missions, and finding investigators —
 * links, not tabs over panels, so each is an address. Not a new navigation destination: the phone
 * bar keeps its five (owner decision, 2026-09-26).
 */
export async function MissionsViews({ current }: { current: 'mine' | 'find' }) {
  const t = await getT();
  const views = [
    { key: 'mine', href: '/missions', label: t('missions.views.mine') },
    { key: 'find', href: DISCOVERY_PATH, label: t('missions.views.find') },
  ] as const;
  return (
    <nav aria-label={t('missions.views.label')} className="mt-4">
      <ul className="grid grid-cols-2 gap-1 rounded-lg bg-surface-sunken p-1 sm:inline-grid">
        {views.map((v) => (
          <li key={v.key}>
            <Link
              href={v.href}
              aria-current={v.key === current ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium text-text-muted',
                v.key === current && 'bg-surface-raised text-text shadow-raised',
              )}
            >
              {v.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
