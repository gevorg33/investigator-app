'use client';

import { CircleCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { AgencyDetails } from '@/lib/api/types';
import { AGENCY_DETAILS, type AgencyDetail } from './agency-details';
import { AgencyDetailsFields, type AgencyDetailOptions } from './agency-details-fields';
import { MissingDetails } from './agency-missing';

/**
 * Completing or changing an agency's five details (T-150), for its owner. Sends only what changed,
 * with the version read; the save that completes the minimum is the one that makes the agency
 * usable, and the page says so. A 409 — changed elsewhere — asks for a reload rather than
 * overwriting. The shell is refreshed after a save, so the switcher and its notice agree.
 */
export function AgencyDetailsForm({
  agency,
  ...options
}: AgencyDetailOptions & { agency: AgencyDetails }) {
  const t = useTranslations('workspace.agency_details');
  const tl = useTranslations() as unknown as LooseT;
  const router = useRouter();
  const [current, setCurrent] = useState(agency);
  const [outcome, setOutcome] = useState<'saved' | 'activated' | null>(null);

  const { pending, error, onSubmit } = useSubmit(
    async (form) => {
      setOutcome(null);
      const sent: Partial<Record<AgencyDetail, string>> = {};
      for (const field of AGENCY_DETAILS) {
        // All five inputs are always in the form.
        const value = String(form.get(field)).trim();
        if (value !== (current[field] ?? '')) sent[field] = value;
      }
      if (Object.keys(sent).length === 0) return current;
      return (await callApi<AgencyDetails>('/agencies/current', {
        method: 'PATCH',
        body: { version: current.version, ...sent },
      }))!;
    },
    (saved) => {
      setOutcome(
        current.status === 'CREATING' && saved.status === 'ACTIVE' ? 'activated' : 'saved',
      );
      setCurrent(saved);
      router.refresh();
    },
  );
  const fields = fieldErrorKeys(error, tl);

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4">
      {current.status === 'CREATING' && <MissingDetails missing={current.missing} />}
      <FormError error={error} shown={[...AGENCY_DETAILS]} />
      <AgencyDetailsFields
        values={current}
        errors={Object.fromEntries(
          AGENCY_DETAILS.map((f) => [f, fields[f] === undefined ? undefined : tl(fields[f])]),
        )}
        {...options}
      />
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {outcome !== null && (
          <span className="inline-flex items-center gap-2 text-text-muted">
            <CircleCheck aria-hidden className="size-4" />
            {t(outcome)}
          </span>
        )}
      </p>
      <Button type="submit" disabled={pending} aria-busy={pending} className="w-full sm:w-auto">
        {t('save')}
      </Button>
    </form>
  );
}
