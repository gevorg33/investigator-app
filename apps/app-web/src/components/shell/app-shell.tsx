import type { ReactNode } from 'react';
import { getT } from '@/i18n/server';
import { NavLinks } from './nav-links';

/**
 * The workspace frame (responsive-design). Authored for the phone first: content, and a bottom
 * bar with every primary destination that respects the home indicator. From `md` up, the same
 * destinations move to a sidebar and the bar goes. Full height is `dvh`, so mobile browser
 * chrome never cuts off the bottom.
 */
export async function AppShell({
  children,
  notices,
}: {
  children: ReactNode;
  notices?: ReactNode;
}) {
  const t = await getT();
  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-(--z-toast) focus:rounded-md focus:bg-surface-overlay focus:px-4 focus:py-3 focus:shadow-overlay"
      >
        {t('shell.skip_to_content')}
      </a>

      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-6 md:border-r md:border-border md:bg-surface-raised md:px-3 md:py-6">
        <p className="px-3 text-lg font-semibold">{t('app.name')}</p>
        <nav aria-label={t('shell.nav.label')}>
          <NavLinks layout="rail" />
        </nav>
      </aside>

      <main id="content" tabIndex={-1} className="min-w-0 flex-1 pb-bottom-nav md:pb-0">
        {notices}
        {children}
      </main>

      <nav
        aria-label={t('shell.nav.label')}
        className="fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-border bg-surface-raised pb-safe md:hidden"
      >
        <NavLinks layout="bar" />
      </nav>
    </div>
  );
}
