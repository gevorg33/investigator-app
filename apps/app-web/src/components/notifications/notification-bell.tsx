'use client';

import { Bell, X } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NotificationCentre } from './notification-centre';
import { useUnread } from './notifications-provider';

/** Past this, the badge says "99+": a count that wide would cover the bell it belongs to. */
const MOST = 99;

/** The bell: its name carries the count in words, so the badge itself is not read out twice. */
function Trigger(props: ComponentProps<typeof Button>) {
  const t = useTranslations('notifications');
  const { count } = useUnread();
  const shown = count ?? 0;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('open', { count: shown })}
      {...props}
      className="relative"
    >
      <Bell aria-hidden className="size-5" />
      {shown > 0 && (
        <span
          aria-hidden
          className="absolute top-1 right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs leading-none font-semibold text-primary-foreground"
        >
          {shown > MOST ? `${MOST}+` : shown}
        </span>
      )}
    </Button>
  );
}

/**
 * The notification bell in the shell (T-169), with the unread count on it. From `md` up it opens
 * the centre in a popover beside the sidebar; on a phone, in a sheet from the bottom
 * (responsive-design: a sheet, never a squeezed popover). Opening a notification closes either.
 */
export function NotificationBell({ layout }: { layout: 'popover' | 'sheet' }) {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  if (layout === 'popover') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Trigger />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          // Clear of the sidebar's edge: the bell sits inside its padding.
          sideOffset={16}
          aria-labelledby="notifications-title"
          className="flex w-96 flex-col overflow-hidden"
        >
          {/* Within what the window has left (the content's own cap), and never taller than this. */}
          {open && (
            <div className="flex max-h-128 min-h-0 flex-1 flex-col">
              <NotificationCentre
                title={
                  <h2 id="notifications-title" className="text-base font-semibold">
                    {t('title')}
                  </h2>
                }
                onNavigate={close}
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer direction="bottom" open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Trigger />
      </DrawerTrigger>
      <DrawerContent aria-describedby={undefined}>
        {open && (
          <NotificationCentre
            title={<DrawerTitle>{t('title')}</DrawerTitle>}
            close={
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" aria-label={t('close')}>
                  <X aria-hidden />
                </Button>
              </DrawerClose>
            }
            onNavigate={close}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}
