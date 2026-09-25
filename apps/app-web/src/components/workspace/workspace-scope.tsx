'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { pinWorkspace } from '@/lib/api/workspace';
import type { WorkspaceView } from '@/lib/api/types';

/** Set just before the page reloads into a newly chosen workspace; read once when it arrives. */
export const SWITCHED_KEY = 'workspace-switched';

/** A workspace's name as the reader sees it: a Personal workspace has none of its own. */
export function useWorkspaceName(): (w: WorkspaceView) => string {
  const t = useTranslations('workspace');
  return (w) => w.name ?? t('personal');
}

/**
 * The workspace this page was rendered in (T-092). Every browser call from inside names it as
 * `X-Workspace` (`lib/api/workspace.ts`). The workspace layout keys this by the workspace's id, so
 * nothing held in a client component — a conversation, a draft, a list — outlives a switch.
 */
export function WorkspaceScope({
  workspace,
  children,
}: {
  workspace: WorkspaceView | null;
  children: ReactNode;
}) {
  // During render, not in an effect: children's effects run first, and one of them may call the API.
  pinWorkspace(workspace?.id ?? null);
  return children;
}

/**
 * "Now working in …", once, on the page a switch lands on — the switch's confirmation. It fades in
 * (the duration is 0 under reduced motion, so it simply appears) and is announced politely.
 */
export function SwitchedNotice({ workspace }: { workspace: WorkspaceView }) {
  const t = useTranslations('workspace');
  const name = useWorkspaceName();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SWITCHED_KEY) !== workspace.id) return;
      sessionStorage.removeItem(SWITCHED_KEY);
      setShown(true);
    } catch {
      // Storage refused (a private window): the switch happened; it is just not remarked on.
    }
  }, [workspace.id]);
  if (!shown) return null;
  return (
    <p
      role="status"
      className="mx-auto w-full max-w-3xl px-4 pt-4 text-sm font-medium text-primary transition-opacity duration-(--duration-slow) ease-enter starting:opacity-0 md:px-8"
    >
      {t('switched', { name: name(workspace) })}
    </p>
  );
}
