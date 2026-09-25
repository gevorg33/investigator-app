'use client';

// @shadcn/alert-dialog, adopted in T-057 and re-tokenised: `@radix-ui/react-alert-dialog`, pinned;
// the scrim token behind it; **a bottom sheet on a phone** and centred from `sm` (responsive-design:
// a modal on a phone is a sheet), padded for the home indicator; the raised surface and overlay
// shadow; buttons full width on a phone, the safe choice last so it sits under the thumb; the
// enter/exit animation classes (a plugin the app does not load) removed. `size` and
// `AlertDialogMedia` dropped. Radix focuses Cancel first — never the destructive action.
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function AlertDialog(props: ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-(--z-modal) bg-scrim/50"
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-(--z-modal) grid gap-4 rounded-t-xl border-t border-border bg-surface-raised p-6 pb-safe shadow-overlay',
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:pb-6',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-header" className={cn('grid gap-2', className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col gap-2 sm:flex-row-reverse sm:justify-start', className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-text-muted', className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button variant={variant} asChild>
      <AlertDialogPrimitive.Action data-slot="alert-dialog-action" className={className} {...props} />
    </Button>
  );
}

function AlertDialogCancel({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <Button variant="outline" asChild>
      <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" className={className} {...props} />
    </Button>
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
