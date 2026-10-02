import { NotFoundPage } from '@/components/not-found-page';
import { getT } from '@/i18n/server';

/** Another agency's profile, a Personal one, or none — the same page: back to the agency's list. */
export default async function HeldInvestigatorNotFound() {
  const t = await getT();
  return (
    <NotFoundPage back={{ href: '/agency/investigators', label: t('agency.investigators.back') }} />
  );
}
