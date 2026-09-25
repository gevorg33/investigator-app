'use client';

import { FilePen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { MissionFields, OwnMission } from '@/lib/api/types';

/**
 * A rejected mission is closed for good (the state machine has no way out of REJECTED); revising
 * it is a new draft with the same answers, opened at the brief so the customer can change what the
 * moderator pointed to. The lawful-purpose confirmation is never copied — it is ticked afresh.
 */
export function ReviseMission({ fields }: { fields: MissionFields }) {
  const t = useTranslations('missions.view.rejected');
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    () => callApi<OwnMission>('/missions/me', { body: fields }),
    (created) => router.push(`/missions/${created!.id}?step=review`),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <FormError error={error} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        <FilePen aria-hidden />
        {t('revise')}
      </Button>
    </form>
  );
}
