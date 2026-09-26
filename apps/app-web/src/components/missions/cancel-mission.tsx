'use client';

import { CircleX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
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
import { ApiError, callApi } from '@/lib/api/browser';
import type { OwnMission } from '@/lib/api/types';

type Target = Pick<OwnMission, 'id' | 'version'>;

/**
 * Cancelling a mission the customer can still take back (T-154): a draft, or one under review.
 * Asked first, in an `AlertDialog` that says what closes — cancelling is final, the state machine
 * has no way out of CANCELLED. Done, the customer lands on their missions, where it is listed as
 * cancelled. If it moved on meanwhile (409), that is said and the page reloads to where it stands.
 *
 * `prepare` lets the intake finish a save under way first and name the version it returned; a sent
 * mission cannot change under the customer, so it passes the version it was rendered with.
 */
export function CancelMission({
  mission,
  stage,
  prepare,
}: {
  mission: Target;
  stage: 'draft' | 'review';
  prepare?: () => Promise<Target | null>;
}) {
  const t = useTranslations('missions.cancel');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const cancel = async () => {
    setPending(true);
    setError(null);
    try {
      const target = prepare === undefined ? mission : await prepare();
      if (target === null) return;
      await callApi(`/missions/me/${target.id}/cancel`, { body: { version: target.version } });
      router.push('/missions');
      router.refresh();
    } catch (e) {
      const failed =
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');
      setError(failed);
      if (failed.code === 'STATE_CONFLICT') router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3">
      <FormError error={error} overrides={{ STATE_CONFLICT: 'missions.cancel.conflict' }} />
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="text-danger"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        <CircleX aria-hidden />
        {t('action')}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${stage}.title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${stage}.body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction variant="destructive" onClick={() => void cancel()}>
              {t('confirm')}
            </AlertDialogAction>
            <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
