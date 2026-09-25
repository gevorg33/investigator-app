'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { navigate } from '@/lib/navigate';

/**
 * Ending a session. Another device's ends at once (the API refuses its next request); this
 * device's goes through the API's sign-out, which clears the cookie, and then to sign-in.
 */
export function EndSession({ id, current }: { id: string; current: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    () =>
      current
        ? callApi('/auth/logout')
        : callApi(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    () => (current ? navigate('/sign-in') : router.refresh()),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <FormError error={error} />
      <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
        {current ? t('account.sessions.sign_out_here') : t('account.sessions.sign_out_other')}
      </Button>
    </form>
  );
}
