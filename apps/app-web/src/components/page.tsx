import type { ReactNode } from 'react';

/** A screen's title and body, at a readable measure, with room for the thumb at the edges. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
