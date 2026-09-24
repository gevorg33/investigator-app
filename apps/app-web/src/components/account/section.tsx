import type { ReactNode } from 'react';

/** One part of the Account page: a titled card, reachable by its id (`/account#legal`). */
export function AccountSection({
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
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mt-6 grid scroll-mt-6 gap-4 rounded-lg border border-border bg-surface-raised p-6"
    >
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        {body !== undefined && <p className="text-sm text-text-muted">{body}</p>}
      </div>
      {children}
    </section>
  );
}
