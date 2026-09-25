'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import type { CategoryOption } from '@/components/missions/filter-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { callApi } from '@/lib/api/browser';
import { cn } from '@/lib/utils';

/**
 * What an investigator does (T-123), chosen from the shared taxonomy — never typed (ADR-0007): a
 * searchable, indented list where each tap adds or removes one, with the choices shown as badges.
 */
export function SpecialtiesPicker({
  chosen,
  categories,
}: {
  chosen: readonly string[];
  categories: readonly CategoryOption[];
}) {
  const t = useTranslations('investigator.specialties');
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([...chosen]);
  const [saved, setSaved] = useState(false);
  const labels = new Map(categories.map((c) => [c.id, c.label]));
  const toggle = (id: string) =>
    setIds((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));
  const { pending, error, onSubmit } = useSubmit(
    () => {
      setSaved(false);
      return callApi('/profiles/investigator/me', {
        method: 'PATCH',
        body: { specialtyNodeIds: ids },
      });
    },
    () => {
      setSaved(true);
      router.refresh();
    },
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError error={error} />
      <p className="text-sm text-text-muted" aria-live="polite">
        {t('chosen', { count: ids.length })}
      </p>
      {ids.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <li key={id}>
              <Badge variant="secondary">{labels.get(id) ?? id}</Badge>
            </li>
          ))}
        </ul>
      )}
      <Command
        label={t('search')}
        filter={(value, search) =>
          labels.get(value)?.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
        }
      >
        <CommandInput placeholder={t('search')} />
        <CommandList>
          <CommandEmpty>{t('none')}</CommandEmpty>
          {categories.map((c) => (
            <CommandItem
              key={c.id}
              value={c.id}
              onSelect={() => toggle(c.id)}
              className={cn(c.depth === 0 && 'font-medium')}
            >
              <Check
                aria-hidden
                className={cn('size-4', ids.includes(c.id) ? 'opacity-100' : 'opacity-0')}
              />
              <span className={cn(c.depth === 1 && 'pl-4', c.depth >= 2 && 'pl-8')}>{c.label}</span>
              {/* The space keeps "selected" a word of its own in the option's accessible name. */}
              {ids.includes(c.id) && (
                <>
                  {' '}
                  <span className="sr-only">{t('selected')}</span>
                </>
              )}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('save')}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-success">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  );
}
