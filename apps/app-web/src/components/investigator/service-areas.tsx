'use client';

import { LocateFixed, MapPin, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { callApi } from '@/lib/api/browser';
import type { LonLat, OwnServiceArea } from '@/lib/api/types';
import type { CodeOption } from '@/lib/codes';

/** The radii offered, in kilometres. The API takes 5 to 300. */
export const RADII = [5, 10, 25, 50, 100] as const;

/**
 * A position to two decimal places — about a kilometre — which is all the database keeps
 * (service-areas.md). Rounded here too, so the precise position never leaves the device.
 */
export const coarse = (p: GeolocationPosition): LonLat => ({
  lon: Math.round(p.coords.longitude * 100) / 100,
  lat: Math.round(p.coords.latitude * 100) / 100,
});

type Locating = 'idle' | 'locating' | 'found' | 'denied' | 'failed';

function Remove({ area }: { area: OwnServiceArea }) {
  const t = useTranslations('investigator.areas');
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    () => callApi(`/service-areas/me/${encodeURIComponent(area.id)}`, { method: 'DELETE' }),
    () => router.refresh(),
  );
  return (
    <form onSubmit={onSubmit} className="contents">
      <FormError error={error} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={t('remove', { label: area.label })}
      >
        <X aria-hidden />
      </Button>
    </form>
  );
}

/**
 * Where an investigator works (T-123). There is no map yet — no map or place-search provider has
 * been chosen, and either would send locations to a third party (owner decision, 2026-09-25) — so
 * an area is the device's own location, rounded, with a radius. Country and city are labels the
 * investigator names, which discovery's country and city filters match on.
 */
export function ServiceAreas({
  areas,
  countries,
}: {
  areas: readonly OwnServiceArea[];
  /** Every country, named in the reader's language — from the server, so hydration agrees. */
  countries: readonly CodeOption[];
}) {
  const t = useTranslations('investigator.areas');
  const router = useRouter();
  const [locating, setLocating] = useState<Locating>('idle');
  const [centre, setCentre] = useState<LonLat | null>(null);
  const [radius, setRadius] = useState<string>('25');
  const countryName = new Map(countries.map((c) => [c.code, c.name]));

  const locate = () => {
    setLocating('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCentre(coarse(position));
        setLocating('found');
      },
      (err) => setLocating(err.code === err.PERMISSION_DENIED ? 'denied' : 'failed'),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
    );
  };

  const { pending, error, onSubmit } = useSubmit(
    (form) => {
      // Both are always in the form: it is only submitted once a location is found.
      const country = String(form.get('country'));
      const city = String(form.get('city')).trim();
      return callApi('/service-areas/me', {
        body: {
          kind: 'RADIUS',
          label: String(form.get('label')).trim(),
          centre,
          radiusKm: Number(radius),
          ...(country !== '' ? { countryCode: country } : {}),
          ...(city !== '' ? { city } : {}),
        },
      });
    },
    () => {
      setCentre(null);
      setLocating('idle');
      router.refresh();
    },
  );

  return (
    <div className="grid gap-6">
      {areas.length === 0 ? (
        <p className="text-sm text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="grid gap-2">
          {areas.map((area) => (
            <li
              key={area.id}
              className="flex items-center gap-3 rounded-md border border-border p-2 pl-4"
            >
              <MapPin aria-hidden className="size-4 shrink-0 text-primary" />
              <div className="grid flex-1 text-sm">
                <span className="font-medium">{area.label}</span>
                <span className="text-text-muted">
                  {[
                    area.radiusKm === null ? t('drawn') : t('around', { km: area.radiusKm }),
                    area.city,
                    area.countryCode === null
                      ? null
                      : (countryName.get(area.countryCode) ?? area.countryCode),
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </span>
              </div>
              <Remove area={area} />
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="grid gap-4 rounded-lg border border-border p-4">
        <h3 className="font-semibold">{t('add_title')}</h3>
        <FormError error={error} />
        <div className="grid gap-2">
          <Button
            type="button"
            variant={centre === null ? 'default' : 'outline'}
            onClick={locate}
            disabled={locating === 'locating'}
            aria-busy={locating === 'locating'}
          >
            <LocateFixed aria-hidden />
            {locating === 'locating' ? t('locating') : t('locate')}
          </Button>
          {locating === 'found' && (
            <p role="status" className="text-sm text-success">
              {t('located')}
            </p>
          )}
          {(locating === 'denied' || locating === 'failed') && (
            <p role="alert" className="text-sm text-danger">
              {locating === 'denied' ? t('denied') : t('failed')}
            </p>
          )}
        </div>

        {centre !== null && (
          <>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('radius')}</legend>
              <ToggleGroup
                type="single"
                value={radius}
                onValueChange={(v) => {
                  if (v !== '') setRadius(v);
                }}
                aria-label={t('radius')}
              >
                {RADII.map((km) => (
                  <ToggleGroupItem key={km} value={String(km)}>
                    {t('radius_km', { km })}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </fieldset>
            <Field label={t('label')} hint={t('label_hint')} name="label" required maxLength={80} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                {t('country')}
                <NativeSelect name="country" defaultValue="">
                  <option value="">{t('country_none')}</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <Field label={t('city')} name="city" maxLength={80} />
            </div>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {t('add')}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
