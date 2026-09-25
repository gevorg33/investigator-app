import { formatRelativeTime, type Locale } from '@investigator/i18n';
import { FilePlus2 } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/i18n/server';
import { serverApi } from '@/lib/api/server';
import type { OwnMission } from '@/lib/api/types';

/**
 * A customer's own missions (T-119), newest first, each opening where it stands: a draft opens the
 * intake at the next unanswered question, anything sent opens what happened to it. A draft a
 * moderator returned says so on its card, so it is not mistaken for one never sent.
 */
export async function OwnMissions({ locale, now }: { locale: Locale; now: Date }) {
  const t = await getT();
  const missions = (await serverApi<OwnMission[]>('/missions/me')) ?? [];
  const create = (
    <Button asChild className="w-full sm:w-auto">
      <Link href="/missions/new">
        <FilePlus2 aria-hidden />
        {t('missions.own.new')}
      </Link>
    </Button>
  );
  if (missions.length === 0) {
    return (
      <>
        <EmptyState
          icon={FilePlus2}
          title={t('missions.own.empty.title')}
          body={t('missions.own.empty.body')}
        />
        <div className="mt-4">{create}</div>
      </>
    );
  }
  return (
    <div className="mt-4 grid gap-4">
      <div>{create}</div>
      <ul className="grid gap-3" aria-label={t('missions.own.list')}>
        {missions.map((m) => (
          <li key={m.id}>
            <Link
              href={`/missions/${m.id}`}
              className="block rounded-xl hover:bg-surface-sunken"
            >
              <Card>
                <CardHeader>
                  <CardTitle className={m.title === null ? 'text-text-muted' : undefined}>
                    {m.title ?? t('missions.own.untitled')}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={m.review !== null ? 'warning' : 'secondary'}>
                      {m.review?.outcome === 'CHANGES_REQUESTED'
                        ? t('missions.own.returned')
                        : t(`missions.status.${m.status}`)}
                    </Badge>
                    <span className="text-sm text-text-muted">
                      {t('missions.own.changed', {
                        when: formatRelativeTime(m.updatedAt, now, locale),
                      })}
                    </span>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
