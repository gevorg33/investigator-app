'use client';

import { LogOut } from 'lucide-react';
import { useSubmit } from '@/components/form/use-submit';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/messages';
import { callApi } from '@/lib/api/browser';
import { navigate } from '@/lib/navigate';

/** Ends this console session: the API clears its cookie on this origin, then to sign-in. */
export function SignOut() {
  const { pending, error, onSubmit } = useSubmit(
    () => callApi('/auth/logout'),
    () => navigate('/sign-in'),
  );
  return (
    <form onSubmit={onSubmit}>
      <FormError error={error} />
      <Button type="submit" variant="ghost" disabled={pending} aria-busy={pending}>
        <LogOut aria-hidden />
        {t('shell.sign_out')}
      </Button>
    </form>
  );
}
