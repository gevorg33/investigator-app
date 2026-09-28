import { Button } from '@/components/ui/button';

/** Where Google sign-in starts, and where connecting it to a signed-in account does (T-062). */
export const GOOGLE_START = '/api/v1/auth/google/start';
export const GOOGLE_LINK = '/api/v1/auth/google/link';

/**
 * Leaves for Google. A form, not a fetch or a link: the trip is a top-level navigation the browser
 * makes itself — to the API, which answers with Google's address — and `next` rides along as the
 * place to come back to.
 */
export function GoogleButton({
  label,
  next = '/',
  action = GOOGLE_START,
}: {
  label: string;
  next?: string;
  action?: typeof GOOGLE_START | typeof GOOGLE_LINK;
}) {
  return (
    <form method="get" action={action}>
      {next !== '/' && <input type="hidden" name="next" value={next} />}
      <Button type="submit" variant="outline" className="w-full">
        {label}
      </Button>
    </form>
  );
}

/** "or with your email", between Google and the password form. */
export function OrDivider({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-3 text-sm text-text-muted">
      <span aria-hidden className="h-px flex-1 bg-border" />
      {label}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </p>
  );
}
