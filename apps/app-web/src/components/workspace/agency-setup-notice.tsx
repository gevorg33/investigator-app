import Link from 'next/link';
import { getT } from '@/i18n/server';
import type { WorkspaceView } from '@/lib/api/types';

/** Where an agency's details are completed or changed (T-150). */
export const AGENCY_DETAILS_HREF = '/agencies/current';

/**
 * Above every screen of an agency still being set up (T-150): that it cannot be used yet, and the
 * way to finish it — where, before, "Being set up" in the switcher led nowhere. A notice, like the
 * account's, not a block: its members can still move about.
 */
export async function AgencySetupNotice({ workspace }: { workspace: WorkspaceView }) {
  if (workspace.kind !== 'AGENCY' || workspace.status !== 'CREATING') return null;
  const t = await getT();
  return (
    <p
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border bg-primary-subtle px-4 text-sm md:px-8"
    >
      <span className="py-3">
        {/* An agency always has a name; only a Personal workspace has none. */}
        {t('shell.agency_setup', { name: workspace.name! })}
      </span>
      <Link
        href={AGENCY_DETAILS_HREF}
        className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t('shell.finish')}
      </Link>
    </p>
  );
}
