'use client';

import { breakpoints } from '@investigator/ui-tokens';
import { Gavel } from 'lucide-react';
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
import { ApiError } from '@/lib/api/errors';

/** The API's longest reason (`REASON_MAX`, verification.policy.ts). */
export const REASON_MAX = 2000;

/**
 * Recording a decision (T-070): the whole application, approved or rejected, with a reason — which
 * the API requires for both, and which this form requires before it will send. A sheet from the
 * bottom on a phone, from the side from `md` (responsive-design: a form is a sheet, never a modal
 * scrolled inside a scrolling page). Decided, the page is read again, trail and all.
 */
export function DecisionForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const side = useMediaQuery(`(min-width: ${breakpoints.md})`) ? 'right' : 'bottom';
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const { pending, error, onSubmit } = useSubmit(
    (form) => {
      const reason = String(form.get('reason')).trim();
      // Spaces alone are not a reason. The API refuses them; this says so without asking it.
      if (reason === '') {
        throw new ApiError(
          422,
          'VALIDATION_FAILED',
          'error.validation.verification.reason_required',
        );
      }
      return callApi(`/verification/requests/${encodeURIComponent(requestId)}/decision`, {
        body: { outcome: form.get('outcome'), reason },
      });
    },
    () => {
      setOpen(false);
      router.refresh();
    },
  );

  return (
    <Drawer open={open} onOpenChange={setOpen} direction={side}>
      <DrawerTrigger asChild>
        <Button className="self-start">
          <Gavel aria-hidden />
          {t('decision.open')}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="flex-col items-start">
            <DrawerTitle>{t('decision.title')}</DrawerTitle>
            <DrawerDescription>{t('decision.description')}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4 pb-4">
            <FormError
              error={error}
              overrides={{
                STATE_CONFLICT: 'decision.conflict',
                VALIDATION_FAILED: 'error.validation.verification.reason_required',
              }}
            />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('decision.outcome')}</legend>
              {(['APPROVED', 'REJECTED'] as const).map((outcome) => (
                <label
                  key={outcome}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-border-control px-3"
                >
                  <input type="radio" name="outcome" value={outcome} required className="size-4" />
                  {outcome === 'APPROVED' ? t('decision.approve') : t('decision.reject')}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-1.5">
              <label htmlFor={reasonId} className="text-sm font-medium">
                {t('decision.reason')}
              </label>
              <Textarea
                id={reasonId}
                name="reason"
                required
                maxLength={REASON_MAX}
                aria-describedby={`${reasonId}-hint`}
                className="min-h-28"
              />
              <p id={`${reasonId}-hint`} className="text-sm text-text-muted">
                {t('decision.reason_hint')}
              </p>
            </div>
          </div>
          <DrawerFooter className="flex-col-reverse sm:flex-row sm:justify-end">
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                {t('decision.cancel')}
              </Button>
            </DrawerClose>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {t('decision.submit')}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
