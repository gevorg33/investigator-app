import { NotFoundPage } from '@/components/not-found-page';
import { getT } from '@/i18n/server';

/** A mission that is not the reader's, or not there: back to their own. */
export default async function MissionNotFound() {
  const t = await getT();
  return <NotFoundPage back={{ href: '/missions', label: t('not_found.missions') }} />;
}
