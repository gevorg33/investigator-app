import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountNotices } from '@/components/account/notices';
import { AssistantBeside } from '@/components/assistant/assistant-beside';
import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { AppShell } from '@/components/shell/app-shell';
import { getAccount, getOutstanding } from '@/lib/api/server';

/**
 * Everything in the workspace needs a session (T-127). No session: to sign-in, with the page asked
 * for as `next`, so signing in brings the reader back to it.
 *
 * The assistant (T-056) is mounted here, above every page, so its conversation survives moving
 * between them. It talks to the reader as the role they act as: an investigator unless they chose
 * to see the platform as a customer — the same reading the missions screen makes — and, with no
 * role yet, as someone the API answers from the public policies only.
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const account = await getAccount();
  if (account === null) {
    const path = (await headers()).get('x-pathname') ?? '/';
    redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  }
  const outstanding = await getOutstanding();
  const investigator = account.roles.includes('INVESTIGATOR') && account.activeRole !== 'CUSTOMER';
  const customer = account.roles.includes('CUSTOMER');
  return (
    <AssistantProvider
      audience={investigator ? 'INVESTIGATOR' : customer ? 'CUSTOMER' : 'NONE'}
      activeRole={account.activeRole}
    >
      <AppShell
        notices={
          <AccountNotices
            unverified={!account.emailVerified}
            outstanding={outstanding.length > 0}
          />
        }
        beside={<AssistantBeside />}
      >
        {children}
      </AppShell>
    </AssistantProvider>
  );
}
