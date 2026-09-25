'use client';

import { Building2, Check, ChevronsUpDown, Plus, User, X } from 'lucide-react';
import Link from 'next/link';
import { useState, type ComponentProps } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { callApi } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';
import type { WorkspaceView } from '@/lib/api/types';
import { navigate } from '@/lib/navigate';
import { SWITCHED_KEY, useWorkspaceName } from './workspace-scope';

export const CREATE_AGENCY_HREF = '/agencies/new';

/**
 * Moving to another workspace: the session's default becomes that workspace, then the app loads
 * again from Home. A full load, not a client transition — every list, draft and conversation on
 * screen belongs to the workspace being left, and a reload is the one way none of it can be shown
 * under the new name. The page being left may not exist in the new workspace either; Home does.
 */
export function useSwitchWorkspace() {
  const [target, setTarget] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const switchTo = async (w: WorkspaceView) => {
    // The trigger is disabled while a switch is under way, so only the current one needs refusing.
    if (w.current) return;
    setTarget(w);
    setError(null);
    try {
      await callApi(`/workspaces/${encodeURIComponent(w.id)}/activate`);
      try {
        sessionStorage.setItem(SWITCHED_KEY, w.id);
      } catch {
        // Only the confirmation is lost.
      }
      navigate('/');
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
      setTarget(null);
    }
  };
  return { target, error, switchTo };
}

const Icon = ({ w }: { w: WorkspaceView }) =>
  w.kind === 'PERSONAL' ? <User aria-hidden /> : <Building2 aria-hidden />;

/** One workspace in either list: its icon and name, "being set up" in words, the current one ticked. */
function Row({ w }: { w: WorkspaceView }) {
  const t = useTranslations('workspace');
  const name = useWorkspaceName();
  return (
    <>
      <Icon w={w} />
      <span className="min-w-0 flex-1 truncate">{name(w)}</span>
      {/* Spaces keep each part a word of its own in the item's accessible name; flex drops them. */}
      {w.status === 'CREATING' && (
        <>
          {' '}
          <Badge variant="outline">{t('setting_up')}</Badge>
        </>
      )}
      {w.current && (
        <>
          <Check aria-hidden className="text-primary" />{' '}
          <span className="sr-only">{t('current')}</span>
        </>
      )}
    </>
  );
}

function Trigger({
  current,
  target,
  ...props
}: { current: WorkspaceView; target: WorkspaceView | null } & ComponentProps<typeof Button>) {
  const t = useTranslations('workspace');
  const name = useWorkspaceName();
  return (
    <Button
      variant="outline"
      aria-label={t('switch', { name: name(current) })}
      aria-busy={target !== null}
      disabled={target !== null}
      {...props}
      className="w-full justify-start"
    >
      <Icon w={target ?? current} />
      <span className="min-w-0 flex-1 truncate text-left">
        {target === null ? name(current) : t('switching', { name: name(target) })}
      </span>
      <ChevronsUpDown aria-hidden className="text-text-muted" />
    </Button>
  );
}

/**
 * The workspace switcher (T-092): a menu in the sidebar from `md`, a sheet from the bottom on a
 * phone. Shown only to someone with more than one workspace — for anyone else there is nothing to
 * switch between, and creating an agency is on the Account page.
 */
export function WorkspaceSwitcher({
  workspaces,
  layout,
}: {
  workspaces: readonly WorkspaceView[];
  layout: 'menu' | 'sheet';
}) {
  const t = useTranslations('workspace');
  const { target, error, switchTo } = useSwitchWorkspace();
  const current = workspaces.find((w) => w.current) ?? workspaces[0]!;

  if (layout === 'menu') {
    return (
      <div className="grid gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Trigger current={current} target={target} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            {workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                aria-current={w.current || undefined}
                onSelect={() => void switchTo(w)}
              >
                <Row w={w} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={CREATE_AGENCY_HREF}>
                <Plus aria-hidden />
                {t('create')}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <FormError error={error} />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Drawer direction="bottom">
        <DrawerTrigger asChild>
          <Trigger current={current} target={target} />
        </DrawerTrigger>
        <DrawerContent aria-describedby={undefined}>
          <DrawerHeader>
            <DrawerTitle>{t('title')}</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label={t('close')}>
                <X aria-hidden />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <ul className="grid gap-1 overflow-y-auto px-2 pb-4">
            {workspaces.map((w) => (
              <li key={w.id}>
                <DrawerClose asChild>
                  <button
                    type="button"
                    aria-current={w.current || undefined}
                    onClick={() => void switchTo(w)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-base hover:bg-surface-sunken aria-[current]:font-semibold [&_svg]:size-4 [&_svg]:shrink-0"
                  >
                    <Row w={w} />
                  </button>
                </DrawerClose>
              </li>
            ))}
            <li className="mt-1 border-t border-border pt-1">
              <Link
                href={CREATE_AGENCY_HREF}
                className="flex min-h-11 items-center gap-3 rounded-md px-3 text-base hover:bg-surface-sunken [&_svg]:size-4"
              >
                <Plus aria-hidden />
                {t('create')}
              </Link>
            </li>
          </ul>
        </DrawerContent>
      </Drawer>
      <FormError error={error} />
    </div>
  );
}
