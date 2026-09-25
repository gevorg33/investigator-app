import type { LucideIcon } from 'lucide-react';

/** A whole-screen state — nothing to review, no access — that says what it means and why. */
export function Notice({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <section
      aria-labelledby="notice-title"
      className="grid justify-items-start gap-2 rounded-lg border border-border bg-surface-raised p-6"
    >
      <Icon aria-hidden className="size-6 text-text-muted" />
      <h2 id="notice-title" className="text-lg font-semibold">
        {title}
      </h2>
      <p className="text-text-muted">{body}</p>
    </section>
  );
}
