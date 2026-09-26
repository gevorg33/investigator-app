import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { MissionIntake } from '@/components/missions/intake/mission-intake';
import { intakeOptions } from '@/components/missions/intake/options';
import { isStep } from '@/components/missions/intake/steps';
import { MissionView } from '@/components/missions/mission-view';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { getAccount, serverApi } from '@/lib/api/server';
import type { OwnMission } from '@/lib/api/types';

type Params = Promise<{ id: string }>;

/**
 * The customer's own mission, or nothing: another customer's id is not found, exactly like one that
 * does not exist (the API scopes the read to the caller), and so is a malformed one. Someone who
 * cannot act as a customer here is sent to Missions. Read once per request.
 */
const read = cache(async (id: string): Promise<OwnMission> => {
  try {
    return (await serverApi<OwnMission>(`/missions/me/${encodeURIComponent(id)}`))!;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 404 || e.status === 400) notFound();
    if (e.status === 403) redirect('/missions');
    throw e;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [t, mission] = await Promise.all([getT(), read((await params).id)]);
  return { title: mission.title ?? t('missions.own.untitled') };
}

/**
 * One of the customer's missions (T-119). A draft — new, or returned by a moderator — opens the
 * intake where it stands (or at `?step=`); anything sent shows where it is and the brief as sent.
 */
export default async function MissionPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ step?: string }>;
}) {
  const [{ id }, { step }] = await Promise.all([params, searchParams]);
  const [t, { locale }, mission, account] = await Promise.all([
    getT(),
    getLocale(),
    read(id),
    getAccount(),
  ]);
  const options = await intakeOptions(locale);
  const title = mission.title ?? t('missions.own.untitled');

  if (mission.status === 'DRAFT') {
    return (
      <Page title={title}>
        <MissionIntake mission={mission} step={isStep(step) ? step : undefined} {...options} />
      </Page>
    );
  }

  const name = (list: { code: string; name: string }[], code: string) =>
    list.find((o) => o.code === code)?.name ?? code;
  return (
    <Page title={title}>
      <MissionView
        mission={mission}
        locale={locale}
        timeZone={account!.timezone}
        names={{
          category: options.categories.find((c) => c.id === mission.taxonomyNodeId)?.label ?? null,
          country:
            mission.countryCode === null ? null : name(options.countries, mission.countryCode),
          languages: mission.languages.map((code) => name(options.languages, code)),
        }}
      />
    </Page>
  );
}
