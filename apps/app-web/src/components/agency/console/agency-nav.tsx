'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils';

const PLACES = [
  ['/agency', 'profile'],
  ['/agency/people', 'people'],
  ['/agency/teams', 'teams'],
  ['/agency/investigators', 'investigators'],
] as const;

/**
 * The agency's own pages, side by side (T-093): its profile, its people, its teams and its
 * investigators. Four short links that wrap rather than scroll, each 44px tall, the current one
 * marked by more than colour.
 */
export function AgencyNav() {
  const t = useTranslations('agency.nav');
  const path = usePathname();
  return (
    <nav aria-label={t('label')} className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {PLACES.map(([href, key]) => {
          const current = href === '/agency' ? path === href : path.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-full border px-4 text-sm font-medium',
                  current
                    ? 'border-primary bg-primary-subtle font-semibold text-primary'
                    : 'border-border text-text-muted hover:bg-surface-sunken',
                )}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
