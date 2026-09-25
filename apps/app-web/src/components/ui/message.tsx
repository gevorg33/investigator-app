// @shadcn/message, adopted in T-056 and re-tokenised: `text-sm` → the body size (a conversation is
// read, not scanned), the muted role for the footer. `MessageAvatar` dropped — there are two
// speakers, and alignment and the bubble already say which is which (interaction-design: icons
// carry meaning or go). `MessageGroup` and `MessageHeader` dropped: nothing groups or heads a
// message here.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Message({
  className,
  align = 'start',
  ...props
}: ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        'group/message relative flex w-full min-w-0 gap-2 data-[align=end]:flex-row-reverse',
        className,
      )}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        'flex w-full min-w-0 flex-col gap-2 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end',
        className,
      )}
      {...props}
    />
  );
}

function MessageFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        'flex max-w-full min-w-0 flex-wrap items-center gap-2 text-sm text-text-muted group-data-[align=end]/message:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export { Message, MessageContent, MessageFooter };
