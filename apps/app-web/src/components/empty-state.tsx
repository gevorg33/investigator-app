import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

/**
 * The one shape an empty screen takes here: an icon, what will appear, and why — composed from
 * `@shadcn/empty` (interaction-design: an empty state says what happens next, never "No data"),
 * and the one thing to do about it when there is one.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="mt-6 border border-border bg-surface-raised">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      {children !== undefined && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
