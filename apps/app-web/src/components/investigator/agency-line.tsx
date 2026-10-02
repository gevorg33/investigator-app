'use client';

import { Building2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

/**
 * The agency an investigator works for (T-185), shown under their name wherever a customer sees it:
 * the discovery card, the profile page, the assistant's result card and the investigator's own
 * preview. Nothing for an independent one. The name is the one the API gives — the agency's
 * published profile name, else its registered one (`profile-agency.ts`) — never a member, team or
 * other work of the agency's.
 *
 * `undefined` is an assistant reply stored before T-087 carried the agency: it says nothing, as it
 * said nothing then.
 */
export function AgencyLine({
  agency,
}: {
  agency: { id: string; name: string | null } | null | undefined;
}) {
  const t = useTranslations('investigator.public_name');
  const name = agency?.name ?? null;
  if (name === null) return null;
  return (
    <p className="flex items-start gap-1 text-sm text-text-muted">
      <Building2 aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 wrap-anywhere">{t('agency', { name })}</span>
    </p>
  );
}
