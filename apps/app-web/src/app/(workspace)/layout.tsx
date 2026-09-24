import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountNotices } from '@/components/account/notices';
import { AppShell } from '@/components/shell/app-shell';
import { getAccount, getOutstanding } from '@/lib/api/server';

/**
 * Everything in the workspace needs a session (T-127). No session: to sign-in, with the page asked
 * for as `next`, so signing in brings the reader back to it.
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const account = await getAccount();
  if (account === null) {
    const path = (await headers()).get('x-pathname') ?? '/';
    redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  }
  const outstanding = await getOutstanding();
  return (
    <AppShell
      notices={
        <AccountNotices unverified={!account.emailVerified} outstanding={outstanding.length > 0} />
      }
    >
      {children}
    </AppShell>
  );
}
