import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MissionIntake } from '@/components/missions/intake/mission-intake';
import { intakeOptions } from '@/components/missions/intake/options';
import { isStep } from '@/components/missions/intake/steps';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { getAccount } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('missions.own.new') };
}

/**
 * A new mission (T-119). Nothing is created by opening this: the first answer saved creates the
 * draft, and the address moves to it. Only a customer writes missions; anyone else is sent back to
 * Missions, which says what they can do there.
 */
export default async function NewMissionPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const account = await getAccount();
  if (account === null || !account.roles.includes('CUSTOMER')) redirect('/missions');
  const [t, { locale }, { step }] = await Promise.all([getT(), getLocale(), searchParams]);
  return (
    <Page title={t('missions.own.new')}>
      <MissionIntake
        mission={null}
        step={isStep(step) ? step : undefined}
        {...await intakeOptions(locale)}
      />
    </Page>
  );
}
