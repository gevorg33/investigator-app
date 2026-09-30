'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';

/** Removing one of the caller's blocks (T-052): at once, as it was made — the other is not told. */
export function Unblock({ id }: { id: string }) {
  const t = useTranslations('account.blocks');
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    () => callApi(`/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    () => router.refresh(),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <FormError error={error} />
      <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
        {t('unblock')}
      </Button>
    </form>
  );
}
