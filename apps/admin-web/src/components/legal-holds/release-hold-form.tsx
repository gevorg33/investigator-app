'use client';

import { breakpoints } from '@investigator/ui-tokens';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { useMediaQuery } from '@/hooks/use-media-query';
import { t } from '@/i18n/messages';
import { callApi } from '@/lib/api/browser';
import { REASON_MAX, REASON_MIN } from '@/lib/legal-holds';

/**
 * Releasing a legal hold (T-205): deliberate and final, so it is its own sheet that says so before
 * anything is sent — not a button on the card. A reason as long as the API requires, then the
 * release. Someone else having released it first is said in words, and the sheet stays open.
 */
export function ReleaseHoldForm({ holdId, label }: { holdId: string; label: string }) {
  const router = useRouter();
  const side = useMediaQuery(`(min-width: ${breakpoints.md})`) ? 'right' : 'bottom';
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reasonField = useId();
  const ready = reason.trim().length >= REASON_MIN;

  const { pending, error, onSubmit } = useSubmit(
    () =>
      callApi(`/legal-holds/${encodeURIComponent(holdId)}/release`, {
        body: { reason: reason.trim() },
      }),
    () => {
      setOpen(false);
      router.refresh();
    },
  );

  return (
    <Drawer open={open} onOpenChange={setOpen} direction={side}>
      <DrawerTrigger asChild>
        {/* Named with the record, so a list of "Release" buttons says which each one is for. */}
        <Button variant="outline" className="justify-self-start" aria-label={label}>
          {t('hold.release.open')}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="flex-col items-start">
            <DrawerTitle>{t('hold.release.title')}</DrawerTitle>
            <DrawerDescription>{t('hold.release.description')}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4 pb-4">
            <div className="grid gap-1.5">
              <label htmlFor={reasonField} className="text-sm font-medium">
                {t('hold.release.reason')}
              </label>
              <Textarea
                id={reasonField}
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX}
                aria-describedby={`${reasonField}-hint`}
                className="min-h-28"
              />
              <p id={`${reasonField}-hint`} className="text-sm text-text-muted">
                {t('hold.release.reason_hint')}
              </p>
            </div>
          </div>
          {/* Beside the control that caused it, outside the scroll, as in placing a hold. */}
          {error !== null && (
            <div className="px-4 pb-2">
              <FormError error={error} overrides={{ STATE_CONFLICT: 'hold.release.conflict' }} />
            </div>
          )}
          <DrawerFooter className="flex-col-reverse sm:flex-row sm:justify-end">
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                {t('hold.cancel')}
              </Button>
            </DrawerClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={!ready || pending}
              aria-busy={pending}
            >
              {t('hold.release.submit')}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
