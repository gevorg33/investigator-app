'use client';

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

/** Disconnecting Google from this account, asked first (T-062). Refused if it is the last way in. */
export function DisconnectGoogle({ identityId }: { identityId: string }) {
  const t = useTranslations('account.sign_in');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const disconnect = async () => {
    setError(null);
    try {
      await callApi(`/auth/identities/${identityId}`, { method: 'DELETE' });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    }
  };

  return (
    <div className="grid gap-3">
      <FormError error={error} />
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="w-full sm:w-fit"
        onClick={() => setConfirming(true)}
      >
        {t('disconnect')}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('disconnect_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('disconnect_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction variant="destructive" onClick={() => void disconnect()}>
              {t('disconnect_confirm')}
            </AlertDialogAction>
            <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
