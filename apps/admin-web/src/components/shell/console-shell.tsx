import { ScrollText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@/i18n/messages';
import { SignOut } from './sign-out';

/**
 * The console's frame (T-070): one bar — the console, its queues, who is signed in, sign out — and
 * the screen. Two queues (verification, and missions under review since T-051): a bar that wraps on
 * a phone, rather than a menu that hides two destinations behind a tap (responsive-design). Every
 * queue is listed for every member of staff; whether they may work it is the API's answer, which
 * each queue page says in words.
 */
export function ConsoleShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-(--z-toast) focus:rounded-md focus:bg-surface-overlay focus:px-4 focus:py-3 focus:shadow-overlay"
      >
        {t('shell.skip_to_content')}
      </a>
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 md:px-8">
          {/* On a phone: the console and sign-out on one row, the queues on their own below it. */}
          <p className="mr-auto font-semibold md:mr-0">{t('app.name')}</p>
          <nav
            aria-label={t('shell.nav.label')}
            className="order-last flex w-full flex-wrap gap-1 md:order-none md:w-auto md:flex-1"
          >
            <Link
              href="/verification"
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 hover:bg-surface-sunken"
            >
              <ShieldCheck aria-hidden className="size-4" />
              {t('shell.verification')}
            </Link>
            <Link
              href="/moderation"
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 hover:bg-surface-sunken"
            >
              <ScrollText aria-hidden className="size-4" />
              {t('shell.moderation')}
            </Link>
          </nav>
          <p className="hidden truncate text-sm text-text-muted md:block">
            {t('shell.signed_in_as', { email })}
          </p>
          <SignOut />
        </div>
      </header>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10"
      >
        {children}
      </main>
    </div>
  );
}
