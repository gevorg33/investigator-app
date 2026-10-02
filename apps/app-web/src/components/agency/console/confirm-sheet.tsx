'use client';

import { useRef, useState } from 'react';
import { FormError } from '@/components/form/form-error';
import { useSheetSide } from '@/components/missions/filter-sheet';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import type { ApiError } from '@/lib/api/errors';
import { asApiError, FORBIDDEN } from './shared';

/**
 * Puts focus back where it was when a sheet opened — the button that opened it — once it closes. A
 * sheet opened from state rather than a `DrawerTrigger` has nothing of its own to return to, and
 * focus would otherwise fall to the page's start (T-093). The opener is noted as the sheet begins to
 * open, before focus moves into it. Spread the result onto `DrawerContent`.
 */
export function useReturnFocus(): {
  onOpenAutoFocus: () => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  // Set as the sheet opens; Radix calls onCloseAutoFocus only for a sheet it opened.
  const opener = useRef<HTMLElement>(null!);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement as HTMLElement;
    },
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      opener.current.focus();
    },
  };
}

/**
 * A destructive action, asked first (T-093): a sheet — from the bottom on a phone, the side from
 * `md` — whose title names who or what it acts on, and says what follows. The action runs only on
 * the confirming press; a refusal is said in the sheet and nothing closes.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  body,
  confirm,
  keep,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirm: string;
  keep: string;
  onConfirm: () => Promise<void>;
}) {
  const side = useSheetSide();
  const returnFocus = useReturnFocus();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        // A refusal belongs to the attempt it answered; the next time the sheet opens, it is gone.
        setError(null);
        onOpenChange(next);
      }}
      direction={side}
    >
      <DrawerContent {...returnFocus}>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="grid gap-4 overflow-y-auto px-4 pb-4">
          <DrawerDescription>{body}</DrawerDescription>
          <FormError error={error} overrides={FORBIDDEN} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void run()}
            >
              {confirm}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {keep}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
