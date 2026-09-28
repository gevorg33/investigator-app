'use client';

import { LogOut } from 'lucide-react';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/navigate';

/**
 * Signing out of this device, wherever it is offered: the API ends the session and clears its
 * cookie, then a full load of sign-in, so nothing rendered for the account stays on screen. The
 * platform's session only — a Google account the reader signed in with stays signed in to Google,
 * whose own chooser asks again next time (T-062).
 */
export function SignOut({ label, className }: { label: string; className?: string }) {
  const { pending, error, onSubmit } = useSubmit(
    () => callApi('/auth/logout'),
    () => navigate('/sign-in'),
  );
  return (
    <form onSubmit={onSubmit} className={cn('grid gap-2', className)}>
      <FormError error={error} />
      <Button
        type="submit"
        variant="ghost"
        disabled={pending}
        aria-busy={pending}
        className="justify-start"
      >
        <LogOut aria-hidden />
        {label}
      </Button>
    </form>
  );
}
