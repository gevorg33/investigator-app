'use client';

import { Ban, MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError, callApi } from '@/lib/api/browser';
import type { BlockResult } from '@/lib/api/types';
import { useHideListing } from './blockable-listing';

export type BlockTarget = { investigatorProfileId: string } | { missionId: string };

/**
 * Blocking someone (T-052): an investigator from their profile, a customer from one of their
 * missions. Asked first, in an `AlertDialog` that says what it does and what it does not — the
 * other person is not told, and work already under way is not ended.
 *
 * Done, it shows the result at once rather than waiting on the page's refresh: on a profile it
 * says so in the button's place, and a mission card inside a `BlockableListing` takes itself away.
 * The refresh that follows brings the rest of the page up to date.
 *
 * On a profile it is a plain button; on a mission card, where space is the card's, an item in a
 * "more actions" menu.
 */
export function BlockPerson({
  target,
  as = 'button',
}: {
  target: BlockTarget;
  as?: 'button' | 'menu';
}) {
  const t = useTranslations('account.block');
  const router = useRouter();
  const kind = 'missionId' in target ? 'customer' : 'investigator';
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [live, setLive] = useState(false);
  const [done, setDone] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [, startTransition] = useTransition();
  const hide = useHideListing();

  const block = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await callApi<BlockResult>('/blocks', { body: target });
      setLive(result!.liveAssignments > 0);
      setDone(true);
      hide?.();
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="text-sm">
        {live ? t('live') : t('blocked')}
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <FormError error={error} />
      {as === 'menu' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={trigger} variant="ghost" size="icon" aria-label={t('menu')}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setConfirming(true)}>
              <Ban aria-hidden />
              {t(`action.${kind}`)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          className="justify-self-start text-danger"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          <Ban aria-hidden />
          {t(`action.${kind}`)}
        </Button>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${kind}.title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${kind}.body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction variant="destructive" onClick={() => void block()}>
              {t('confirm')}
            </AlertDialogAction>
            <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
