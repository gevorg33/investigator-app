import { Skeleton } from '@/components/ui/skeleton';

/**
 * While a mission or the intake loads (T-119): a title, the progress bar, a question and its
 * buttons — not the browse's list, which the parent segment's loading shows.
 */
export default function MissionLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-6 h-2 w-full" />
      <Skeleton className="mt-8 h-7 w-3/4" />
      <Skeleton className="mt-4 h-11 w-full" />
      <Skeleton className="mt-4 h-32 w-full" />
      <Skeleton className="mt-8 h-11 w-full" />
    </div>
  );
}
