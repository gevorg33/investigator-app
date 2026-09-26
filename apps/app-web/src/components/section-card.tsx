import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * One part of a page of settings — the investigator profile (T-123), the agency's (T-094): a
 * titled card with what it is for, reachable by its id so a checklist or a link can land on it.
 */
export function SectionCard({
  id,
  title,
  body,
  children,
}: {
  id: string;
  title: string;
  body?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-6 scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle id={`${id}-title`}>{title}</CardTitle>
          {body !== undefined && <p className="text-sm text-text-muted">{body}</p>}
        </CardHeader>
        <CardContent className="grid gap-4">{children}</CardContent>
      </Card>
    </section>
  );
}
