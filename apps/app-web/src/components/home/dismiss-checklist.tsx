'use client';

import { useRouter } from 'next/navigation';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';

/**
 * Hides the agency's onboarding checklist for the workspace — every owner, every device (T-149):
 * saved to the agency's settings against the version read, never kept in the browser.
 */
export function DismissChecklist({ version, label }: { version: number; label: string }) {
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    () =>
      callApi('/agencies/current/settings/general', {
        method: 'PATCH',
        body: { version, values: { onboardingDismissed: true } },
      }),
    () => router.refresh(),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <FormError error={error} />
      <Button
        type="submit"
        variant="ghost"
        className="sm:justify-self-start"
        disabled={pending}
        aria-busy={pending}
      >
        {label}
      </Button>
    </form>
  );
}
