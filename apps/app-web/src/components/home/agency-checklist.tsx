import { CircleCheck, CircleDashed } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/i18n/server';
import { serverApi } from '@/lib/api/server';
import type { AgencyDetails, GeneralSection, OwnAgencyProfile } from '@/lib/api/types';
import { DismissChecklist } from './dismiss-checklist';

/**
 * What is left of an agency's setup, on Home, for its owner (T-149, plan.md: a dismissible
 * checklist, not a wizard). Each item links to the screen where it is done and is ticked from what
 * the API says now — never from a flag this app keeps. Only items whose screens exist are listed:
 * inviting employees joins when their screen does (T-093), verification when it exists (T-088).
 *
 * Who sees it is the API's to say: `mayChange` on the agency's details is true for the one who may
 * change them — the owner. Dismissed, it stays hidden for the workspace on every device.
 */
export async function AgencyChecklist() {
  const agency = await serverApi<AgencyDetails>('/agencies/current');
  if (agency === null || !agency.mayChange) return null;
  const [settings, profile, t] = await Promise.all([
    serverApi<{ general: GeneralSection }>('/agencies/current/settings'),
    serverApi<OwnAgencyProfile>('/agencies/current/profile'),
    getT(),
  ]);
  const general = settings!.general;
  if (general.values.onboardingDismissed) return null;

  const items: Array<{ label: string; done: boolean; href: string }> = [
    {
      label: t('home.checklist.details'),
      done: agency.missing.length === 0,
      href: '/agencies/current',
    },
    { label: t('home.checklist.profile'), done: profile!.publishedAt !== null, href: '/agency' },
  ];
  const complete = items.every((i) => i.done);

  return (
    <section aria-labelledby="agency-checklist-title" className="mt-6">
      <Card>
        <CardHeader>
          <CardTitle id="agency-checklist-title">
            {t('home.checklist.title', { name: agency.name })}
          </CardTitle>
          <p className="text-sm text-text-muted">
            {complete ? t('home.checklist.complete') : t('home.checklist.body')}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-sunken"
                >
                  {item.done ? (
                    <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
                  ) : (
                    <CircleDashed aria-hidden className="size-5 shrink-0 text-text-muted" />
                  )}
                  <span className="flex-1">{item.label}</span>
                  <span className={item.done ? 'text-success' : 'text-text-muted'}>
                    {item.done ? t('home.checklist.done') : t('home.checklist.todo')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <DismissChecklist version={general.version} label={t('home.checklist.dismiss')} />
        </CardContent>
      </Card>
    </section>
  );
}
