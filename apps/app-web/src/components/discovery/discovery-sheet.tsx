'use client';

import { Check, SlidersHorizontal, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
import { Section, useSheetSide } from '@/components/missions/filter-sheet';
import type { CategoryOption } from '@/lib/taxonomy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { NativeSelect } from '@/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CodeOption } from '@/lib/codes';
import { cn } from '@/lib/utils';
import { discoveryHref, narrowingCount, PRICING, type DiscoveryFilters } from './discovery-query';

/** The "any" chip's value: Radix reads an empty value as nothing chosen, so it cannot be ''. */
const ANY = 'any';
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** A weekday name for ISO 8601 day 0 (Monday) to 6 — 2024-01-01 was a Monday. */
export const weekday = (day: number, locale: string, width: 'short' | 'long' = 'long') =>
  new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 1 + day)),
  );

/** Filters without the ones set to `undefined`. */
const compact = (f: Partial<Record<keyof DiscoveryFilters, unknown>>): DiscoveryFilters =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as DiscoveryFilters;

/**
 * What an investigator must offer (T-120), in a sheet: from the bottom on a phone, from the side
 * from `md` — the mission browse's pattern (T-054). Choices are held here until "Show
 * investigators", then become the address, so a search reloads and bookmarks as it is.
 *
 * The specialty is a searchable list, because the taxonomy is long and deep; languages are added
 * one at a time from every language `Intl` names, since a customer may need any of them.
 */
export function DiscoverySheet({
  filters,
  categories,
  countries,
  languages,
  locale,
}: {
  filters: DiscoveryFilters;
  categories: readonly CategoryOption[];
  countries: readonly CodeOption[];
  languages: readonly CodeOption[];
  locale: string;
}) {
  const t = useTranslations('missions.discovery');
  const tp = useTranslations('investigator.details');
  const router = useRouter();
  const side = useSheetSide();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DiscoveryFilters>(filters);
  // Reopening starts from what is applied, not from abandoned choices.
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const set = (patch: Partial<Record<keyof DiscoveryFilters, unknown>>) =>
    setDraft((d) => compact({ ...d, ...patch }));
  const count = narrowingCount(filters);
  const chosen = draft.languages ?? [];
  const names = new Map(languages.map((l) => [l.code, l.name]));

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const city = draft.city?.trim();
    setOpen(false);
    router.push(discoveryHref(compact({ ...draft, city: city || undefined })));
  };

  return (
    <Drawer open={open} onOpenChange={setOpen} direction={side}>
      <DrawerTrigger asChild>
        <Button variant="outline" className="justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden />
            {t('filters')}
          </span>
          {count > 0 && <Badge aria-label={t('active', { count })}>{count}</Badge>}
        </Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby="discovery-sheet-body">
        <DrawerHeader>
          <DrawerTitle>{t('filters')}</DrawerTitle>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" aria-label={t('close')}>
              <X aria-hidden />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <DrawerDescription id="discovery-sheet-body" className="px-4">
          {t('sheet_body')}
        </DrawerDescription>

        <form
          id="discovery-filters"
          onSubmit={apply}
          className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto px-4 py-6"
        >
          <Section title={t('category')}>
            <Command
              label={t('category_search')}
              value={draft.taxonomyNodeId ?? ''}
              filter={(value, search) => {
                const option = categories.find((c) => c.id === value);
                return option?.label.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
              }}
            >
              <CommandInput placeholder={t('category_search')} />
              <CommandList>
                <CommandEmpty>{t('category_none')}</CommandEmpty>
                <CommandItem value="" onSelect={() => set({ taxonomyNodeId: undefined })}>
                  <Check
                    aria-hidden
                    className={cn(
                      'size-4',
                      draft.taxonomyNodeId === undefined ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {t('category_any')}
                </CommandItem>
                {categories.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => set({ taxonomyNodeId: c.id })}
                    className={cn(c.depth === 0 && 'font-medium')}
                  >
                    <Check
                      aria-hidden
                      className={cn(
                        'size-4',
                        draft.taxonomyNodeId === c.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className={cn(c.depth === 1 && 'pl-4', c.depth >= 2 && 'pl-8')}>
                      {c.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </Section>

          <Section title={t('languages')} hint={t('languages_hint')}>
            {chosen.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {chosen.map((code) => {
                  const name = names.get(code) ?? code;
                  return (
                    <li key={code}>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={t('language_remove', { language: name })}
                        onClick={() => {
                          const rest = chosen.filter((c) => c !== code);
                          set({ languages: rest.length > 0 ? rest : undefined });
                        }}
                      >
                        {name}
                        <X aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <label>
              <span className="sr-only">{t('language_add')}</span>
              <NativeSelect
                value=""
                onChange={(e) => set({ languages: [...chosen, e.target.value] })}
              >
                <option value="">{t('language_add')}</option>
                {languages
                  .filter((l) => !chosen.includes(l.code))
                  .map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
              </NativeSelect>
            </label>
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              {t('country')}
              <NativeSelect
                value={draft.countryCode ?? ''}
                onChange={(e) => set({ countryCode: e.target.value || undefined })}
              >
                <option value="">{t('country_any')}</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Field
              label={t('city')}
              name="city"
              maxLength={80}
              value={draft.city ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
            />
          </div>

          <Section title={t('day')}>
            <ToggleGroup
              type="single"
              value={draft.day === undefined ? ANY : String(draft.day)}
              onValueChange={(v) => {
                if (v !== '') set({ day: v === ANY ? undefined : Number(v) });
              }}
              aria-label={t('day')}
            >
              <ToggleGroupItem value={ANY}>{t('day_any')}</ToggleGroupItem>
              {DAYS.map((d) => (
                <ToggleGroupItem key={d} value={String(d)} aria-label={weekday(d, locale)}>
                  {weekday(d, locale, 'short')}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>

          <Section title={t('pricing')}>
            <ToggleGroup
              type="single"
              value={draft.pricingModel ?? ANY}
              onValueChange={(v) => {
                if (v !== '') set({ pricingModel: v === ANY ? undefined : v });
              }}
              aria-label={t('pricing')}
            >
              <ToggleGroupItem value={ANY}>{t('pricing_any')}</ToggleGroupItem>
              {PRICING.map((p) => (
                <ToggleGroupItem key={p} value={p}>
                  {tp(`pricing_${p}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>
        </form>

        <DrawerFooter>
          <Button type="submit" form="discovery-filters">
            {t('show')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDraft({})}>
            {t('reset')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
