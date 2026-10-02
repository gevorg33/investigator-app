import { redirect } from 'next/navigation';
import { getWorkspaces } from '@/lib/api/server';

/**
 * The agency the reader is working in, for its console pages (T-093) — or, anywhere else, Account's
 * agencies, as `/agency` does: a Personal workspace has no people, teams or investigators to show.
 */
export async function currentAgency(): Promise<{ id: string; name: string }> {
  const current = (await getWorkspaces()).find((w) => w.current);
  if (current?.kind !== 'AGENCY') redirect('/account#agencies');
  return { id: current.id, name: current.name! };
}
