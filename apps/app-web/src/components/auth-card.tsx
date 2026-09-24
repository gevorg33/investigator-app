import type { ReactNode } from 'react';

/** One signed-out screen: its title, then its content, spaced for a phone. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
