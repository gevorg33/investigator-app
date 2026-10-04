'use client';

import { breakpoints } from '@investigator/ui-tokens';
import { Scale } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMediaQuery } from '@/hooks/use-media-query';
import { t } from '@/i18n/messages';
import { callApi } from '@/lib/api/browser';
import type { LegalHoldResource } from '@/lib/api/types';
import { REASON_MAX, REASON_MIN, RESOURCES } from '@/lib/legal-holds';

/**
 * Placing a legal hold (T-205, on T-035's API): the kind of record, its id, and the reason — which
 * request, case or instruction the hold answers. Nothing is pre-chosen unless the page is already
 * showing one record's holds, in which case that record is filled in: holding the record you just
 * looked up is the usual next step. The control stays disabled until a kind is chosen, an id is
 * given, and the reason is as long as the API requires. A record that does not exist is said so in
 * words, beside the button. A sheet from the bottom on a phone, from the side from `md`; placed, the
 * page is read again and the sheet starts afresh.
 */
export function PlaceHoldForm({
  resourceType,
  resourceId,
}: {
  resourceType?: LegalHoldResource | undefined;
  resourceId?: string | undefined;
}) {
  const router = useRouter();
  const side = useMediaQuery(`(min-width: ${breakpoints.md})`) ? 'right' : 'bottom';
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LegalHoldResource | null>(resourceType ?? null);
  const [id, setId] = useState(resourceId ?? '');
  const [reason, setReason] = useState('');
  const idField = useId();
  const reasonField = useId();
  const ready = type !== null && id.trim() !== '' && reason.trim().length >= REASON_MIN;

  const { pending, error, onSubmit } = useSubmit(
    () =>
      callApi('/legal-holds', {
        body: { resourceType: type, resourceId: id.trim(), reason: reason.trim() },
      }),
    () => {
      // The next hold is usually on another record: start it from where the page started this one.
      setOpen(false);
      setType(resourceType ?? null);
      setId(resourceId ?? '');
      setReason('');
      router.refresh();
    },
  );

  return (
    <Drawer open={open} onOpenChange={setOpen} direction={side}>
      <DrawerTrigger asChild>
        <Button className="justify-self-start">
          <Scale aria-hidden />
          {t('hold.place.open')}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="flex-col items-start">
            <DrawerTitle>{t('hold.place.title')}</DrawerTitle>
            <DrawerDescription>{t('hold.place.description')}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4 pb-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('hold.place.type')}</legend>
              {RESOURCES.map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-border-control px-3"
                >
                  <input
                    type="radio"
                    name="resourceType"
                    value={value}
                    checked={type === value}
                    onChange={() => setType(value)}
                    className="size-4"
                  />
                  {t(`holds.resource.${value}`)}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-1.5">
              <label htmlFor={idField} className="text-sm font-medium">
                {t('hold.place.id')}
              </label>
              <Input
                id={idField}
                name="resourceId"
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${idField}-hint`}
                className="font-mono"
              />
              <p id={`${idField}-hint`} className="text-sm text-text-muted">
                {t('hold.place.id_hint')}
              </p>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={reasonField} className="text-sm font-medium">
                {t('hold.place.reason')}
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
                {t('hold.place.reason_hint')}
              </p>
            </div>
          </div>
          {/* Beside the control that caused it, outside the scroll: at the top of a long sheet it
              was out of view once the reader had scrolled down to submit. */}
          {error !== null && (
            <div className="px-4 pb-2">
              <FormError error={error} overrides={{ NOT_FOUND: 'hold.place.not_found' }} />
            </div>
          )}
          <DrawerFooter className="flex-col-reverse sm:flex-row sm:justify-end">
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                {t('hold.cancel')}
              </Button>
            </DrawerClose>
            <Button type="submit" disabled={!ready || pending} aria-busy={pending}>
              {t('hold.place.submit')}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
