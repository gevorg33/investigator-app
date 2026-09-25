'use client';

import { Check, SlidersHorizontal, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
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
import type { BrowseFilters, OwnServiceArea } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import {
  browseHref,
  narrowingCount,
  POSTED_DAYS,
  toMinorAmount,
  toWhole,
  WITHIN_KM,
} from './browse-query';

/** A taxonomy node as the category list shows it: indented under its parent. */
export interface CategoryOption {
  id: string;
  label: string;
  depth: number;
}

/** The "any" chip's value: Radix reads an empty value as nothing chosen, so it cannot be ''. */
const ANY = 'any';

/** A change to the filters, where `undefined` means "remove this one". */
type Patch = { [K in keyof BrowseFilters]?: BrowseFilters[K] | undefined };

/** The filters without the ones a patch removed. */
const compact = (f: Patch): BrowseFilters =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as BrowseFilters;

/** The sheet opens from the bottom on a phone and from the side from `md` up. */
function useSheetSide(): 'bottom' | 'right' {
  const [side, setSide] = useState<'bottom' | 'right'>('bottom');
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 48rem)');
    const update = () => setSide(wide.matches ? 'right' : 'bottom');
    update();
    wide.addEventListener('change', update);
    return () => wide.removeEventListener('change', update);
  }, []);
  return side;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
      {hint !== undefined && <p className="text-sm text-text-muted">{hint}</p>}
    </fieldset>
  );
}

/**
 * The browse filters (T-054), in a sheet: everything that narrows the list, out of the way of the
 * list itself. Choices are held here until "Show missions", then become the address — the URL stays
 * the one place a browse is described, so a filtered list reloads, bookmarks and saves as it is.
 *
 * Categories are a searchable list, because a real taxonomy is long and deep; the other choices are
 * chips a thumb can hit.
 */
export function FilterSheet({
  filters,
  categories,
  areas,
  languages,
}: {
  filters: BrowseFilters;
  categories: readonly CategoryOption[];
  areas: readonly OwnServiceArea[];
  languages: readonly string[];
}) {
  const t = useTranslations('missions.browse');
  const locale = useLocale();
  const router = useRouter();
  const side = useSheetSide();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BrowseFilters>(filters);
  // Reopening starts from what is applied, not from abandoned choices.
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const set = (patch: Patch) => setDraft((d) => compact({ ...d, ...patch }));
  const count = narrowingCount(filters);
  const category = draft.taxonomyNodeIds?.[0];

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currency = draft.currency;
    const next = compact({
      ...draft,
      budgetMinMinor: toMinorAmount(String(data.get('min')).trim() || undefined, currency),
      budgetMaxMinor: toMinorAmount(String(data.get('max')).trim() || undefined, currency),
      deadlineTo: String(data.get('due')) || undefined,
    });
    setOpen(false);
    router.push(browseHref(next));
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
      <DrawerContent aria-describedby="filter-sheet-body">
        <DrawerHeader>
          <DrawerTitle>{t('filters')}</DrawerTitle>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" aria-label={t('saved.cancel')}>
              <X aria-hidden />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <DrawerDescription id="filter-sheet-body" className="px-4">
          {t('sheet_body')}
        </DrawerDescription>

        <form
          id="mission-filters"
          onSubmit={apply}
          className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto px-4 py-6"
        >
          <Section title={t('category')}>
            <Command
              label={t('category_search')}
              value={category ?? ''}
              filter={(value, search) => {
                const option = categories.find((c) => c.id === value);
                return option?.label.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
              }}
            >
              <CommandInput placeholder={t('category_search')} />
              <CommandList>
                <CommandEmpty>{t('category_none')}</CommandEmpty>
                <CommandItem value="" onSelect={() => set({ taxonomyNodeIds: undefined })}>
                  <Check
                    aria-hidden
                    className={cn('size-4', category === undefined ? 'opacity-100' : 'opacity-0')}
                  />
                  {t('category_any')}
                </CommandItem>
                {categories.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => set({ taxonomyNodeIds: [c.id] })}
                    className={cn(c.depth === 0 && 'font-medium')}
                  >
                    <Check
                      aria-hidden
                      className={cn('size-4', category === c.id ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className={cn(c.depth === 1 && 'pl-4', c.depth >= 2 && 'pl-8')}>
                      {c.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </Section>

          {languages.length > 0 && (
            <Section title={t('languages')} hint={t('languages_hint')}>
              <ToggleGroup
                type="multiple"
                value={draft.languages ?? []}
                onValueChange={(v) => set({ languages: v.length === 0 ? undefined : v })}
                aria-label={t('languages')}
              >
                {languages.map((code) => (
                  <ToggleGroupItem key={code} value={code}>
                    {names.of(code)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Section>
          )}

          <Section title={t('card.budget_label')}>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('currency')}
              <NativeSelect
                value={draft.currency ?? ''}
                onChange={(e) => set({ currency: e.target.value || undefined })}
              >
                <option value="">{t('any')}</option>
                {Intl.supportedValuesOf('currency').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('budget_min')}
                name="min"
                inputMode="decimal"
                defaultValue={
                  filters.budgetMinMinor === undefined
                    ? ''
                    : toWhole(filters.budgetMinMinor, filters.currency)
                }
              />
              <Field
                label={t('budget_max')}
                name="max"
                inputMode="decimal"
                defaultValue={
                  filters.budgetMaxMinor === undefined
                    ? ''
                    : toWhole(filters.budgetMaxMinor, filters.currency)
                }
              />
            </div>
          </Section>

          <Field
            label={t('due_by')}
            name="due"
            type="date"
            defaultValue={filters.deadlineTo ?? ''}
          />

          <Section title={t('posted')}>
            <ToggleGroup
              type="single"
              value={draft.postedWithinDays?.toString() ?? ANY}
              onValueChange={(v) =>
                set({ postedWithinDays: v === '' || v === ANY ? undefined : Number(v) })
              }
              aria-label={t('posted')}
            >
              <ToggleGroupItem value={ANY}>{t('posted_any')}</ToggleGroupItem>
              {POSTED_DAYS.map((days) => (
                <ToggleGroupItem key={days} value={String(days)}>
                  {t('posted_days', { days })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>

          {areas.length > 0 && (
            <Section title={t('within')}>
              <label className="grid gap-1.5 text-sm font-medium">
                {t('area')}
                <NativeSelect
                  value={draft.serviceAreaId ?? ''}
                  onChange={(e) => set({ serviceAreaId: e.target.value || undefined })}
                >
                  <option value="">{t('area_nearest')}</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <ToggleGroup
                type="single"
                value={draft.withinKm?.toString() ?? ANY}
                onValueChange={(v) =>
                  set({ withinKm: v === '' || v === ANY ? undefined : Number(v) })
                }
                aria-label={t('within')}
              >
                <ToggleGroupItem value={ANY}>{t('within_any')}</ToggleGroupItem>
                {WITHIN_KM.map((km) => (
                  <ToggleGroupItem key={km} value={String(km)}>
                    {km === 0 ? t('within_inside') : t('within_km', { km })}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Section>
          )}
        </form>

        <DrawerFooter>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => {
              setOpen(false);
              // Reset clears what narrows the list; the words and the order stay.
              router.push(
                browseHref({
                  ...(filters.q !== undefined ? { q: filters.q } : {}),
                  ...(filters.sort !== undefined ? { sort: filters.sort } : {}),
                }),
              );
            }}
          >
            {t('reset')}
          </Button>
          <Button type="submit" form="mission-filters" className="flex-1">
            {t('show')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
