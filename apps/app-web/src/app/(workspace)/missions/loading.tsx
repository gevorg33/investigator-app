import { Skeleton } from '@/components/ui/skeleton';

/**
 * While a browse loads (T-054): the shape of the controls and three cards, so the page does not
 * jump when the list arrives. Announced by the page that replaces it, not by this.
 */
export default function MissionsLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-7 h-11 w-full" />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
      <div className="mt-6 grid gap-4">
        {['a', 'b', 'c'].map((k) => (
          <Skeleton key={k} className="h-56 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
