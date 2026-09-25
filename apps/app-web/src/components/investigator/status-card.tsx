'use client';

import { CircleCheck, CircleDashed, Eye, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api/errors';
import { callApi } from '@/lib/api/browser';
import type { OwnInvestigatorProfile, PublicInvestigatorProfile } from '@/lib/api/types';
import { PublicProfileCard } from './public-profile-card';

/**
 * Where the profile stands (T-123): what stands between the investigator and being listed — each
 * item a link to where it is done — the two switches that are theirs to flip, and a preview of
 * exactly what customers see.
 */
export function StatusCard({
  profile,
  preview,
  areas,
  specialties,
}: {
  profile: OwnInvestigatorProfile;
  preview: PublicInvestigatorProfile;
  areas: number;
  specialties: ReadonlyArray<readonly [string, string]>;
}) {
  const t = useTranslations('investigator');
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const checks: Array<[string, boolean, string]> = [
    [t('status.published'), profile.visibility === 'PUBLISHED', '#status'],
    [t('status.verified'), profile.verificationStatus === 'VERIFIED', '#verification'],
    [t('status.accepting'), profile.acceptingWork, '#status'],
    [t('status.languages'), profile.languages.length > 0, '#languages'],
    [t('status.specialties'), profile.specialtyNodeIds.length > 0, '#specialties'],
    [t('status.areas'), areas > 0, '#areas'],
  ];
  const ready = checks.every(([, done]) => done);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await callApi('/profiles/investigator/me', { method: 'PATCH', body: patch });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="status" aria-labelledby="status-title" className="mt-6 scroll-mt-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle id="status-title">{t('status.title')}</CardTitle>
            <Badge variant={profile.verificationStatus === 'VERIFIED' ? 'default' : 'outline'}>
              {t(`verification_status.${profile.verificationStatus}`)}
            </Badge>
          </div>
          <p className="text-sm text-text-muted">{ready ? t('status.ready') : t('status.body')}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="grid gap-1">
            {checks.map(([label, done, href]) => (
              <li key={label}>
                <a
                  href={href}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-sunken"
                >
                  {done ? (
                    <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
                  ) : (
                    <CircleDashed aria-hidden className="size-5 shrink-0 text-text-muted" />
                  )}
                  <span className="flex-1">{label}</span>
                  <span className={done ? 'text-success' : 'text-text-muted'}>
                    {done ? t('status.done') : t('status.todo')}
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <div className="grid gap-1 border-t border-border pt-3">
            <FormError error={error} />
            {(
              [
                [
                  'publish',
                  t('status.publish'),
                  profile.visibility === 'PUBLISHED',
                  (on: boolean) => ({ visibility: on ? 'PUBLISHED' : 'DRAFT' }),
                ],
                [
                  'accepting',
                  t('status.accept'),
                  profile.acceptingWork,
                  (on: boolean) => ({ acceptingWork: on }),
                ],
              ] as const
            ).map(([key, label, on, patch]) => (
              <label
                key={key}
                htmlFor={`switch-${key}`}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm font-medium"
              >
                {label}
                <Switch
                  id={`switch-${key}`}
                  checked={on}
                  disabled={busy}
                  onCheckedChange={(next) => void save(patch(next))}
                />
              </label>
            ))}
          </div>

          <Drawer direction="bottom">
            <DrawerTrigger asChild>
              <Button variant="outline">
                <Eye aria-hidden />
                {t('status.preview')}
              </Button>
            </DrawerTrigger>
            <DrawerContent aria-describedby="preview-body">
              <DrawerHeader>
                <DrawerTitle>{t('status.preview_title')}</DrawerTitle>
                <DrawerClose asChild>
                  <Button variant="ghost" size="icon" aria-label={t('status.close')}>
                    <X aria-hidden />
                  </Button>
                </DrawerClose>
              </DrawerHeader>
              <DrawerDescription id="preview-body" className="px-4">
                {t('status.preview_body')}
              </DrawerDescription>
              <div className="overflow-y-auto p-4">
                <div className="mx-auto max-w-2xl rounded-lg border border-border p-4">
                  <PublicProfileCard profile={preview} specialties={new Map(specialties)} />
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        </CardContent>
      </Card>
    </section>
  );
}
