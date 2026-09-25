import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { SignOut } from '@/components/shell/sign-out';
import { t } from '@/i18n/messages';
import { getAccount } from '@/lib/api/server';
import { PATHNAME_HEADER } from '@/middleware';

/**
 * Everything in the console needs a staff session on this origin (T-070). No session: to sign-in,
 * with the page asked for as `next`. Signed in but not staff: said so, with sign-out — the API
 * would refuse every queue anyway; this only spares the reader a page of refusals. Which queues a
 * member of staff may work is their scopes', and each queue's API decides it.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const account = await getAccount();
  if (account === null) {
    const path = (await headers()).get(PATHNAME_HEADER) ?? '/verification';
    redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  }
  if (!account.roles.includes('STAFF')) {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-4 px-4 py-10">
        <h1 className="text-2xl font-semibold">{t('staff_only.title')}</h1>
        <p className="text-text-muted">{t('staff_only.body')}</p>
        <SignOut />
      </main>
    );
  }
  return <ConsoleShell email={account.email}>{children}</ConsoleShell>;
}
