'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { DETAIL_LABEL, type AgencyDetail } from './agency-details';

/** An unfinished agency: that it cannot be used yet, and which of the five it still needs. */
export function MissingDetails({ missing }: { missing: readonly string[] }) {
  const t = useTranslations('workspace');
  const names = missing
    .filter((f): f is AgencyDetail => f in DETAIL_LABEL)
    .map((f) => t(`create_agency.${DETAIL_LABEL[f]}`));
  return (
    <Alert>
      <CircleAlert aria-hidden />
      <AlertContent>
        <AlertTitle>{t('agency_details.unfinished')}</AlertTitle>
        {names.length > 0 && <p>{t('agency_details.missing', { fields: names.join(', ') })}</p>}
      </AlertContent>
    </Alert>
  );
}
