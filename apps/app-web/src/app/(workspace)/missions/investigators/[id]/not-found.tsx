import { DISCOVERY_PATH } from '@/components/discovery/discovery-query';
import { NotFoundPage } from '@/components/not-found-page';
import { getT } from '@/i18n/server';

/** A profile that is unpublished, or not there — the same page either way: back to the search. */
export default async function InvestigatorNotFound() {
  const t = await getT();
  return <NotFoundPage back={{ href: DISCOVERY_PATH, label: t('missions.profile.back') }} />;
}
