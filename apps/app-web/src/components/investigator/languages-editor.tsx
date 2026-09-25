'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { callApi } from '@/lib/api/browser';
import type { Proficiency } from '@/lib/api/types';
import type { CodeOption } from '@/lib/codes';

const LEVELS: readonly Proficiency[] = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'];

type Row = { languageCode: string; proficiency: Proficiency };

/**
 * The languages an investigator works in (T-123), each with a level, saved as one set — the API
 * replaces the whole list, so removing one is saving without it.
 */
export function LanguagesEditor({
  languages,
  options,
}: {
  languages: readonly Row[];
  /** Every language, named in the reader's language — from the server, so hydration agrees. */
  options: readonly CodeOption[];
}) {
  const t = useTranslations('investigator.languages');
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([...languages]);
  const [adding, setAdding] = useState('');
  const [saved, setSaved] = useState(false);
  const names = new Map(options.map((o) => [o.code, o.name]));
  const { pending, error, onSubmit } = useSubmit(
    () => {
      setSaved(false);
      return callApi('/profiles/investigator/me', { method: 'PATCH', body: { languages: rows } });
    },
    () => {
      setSaved(true);
      router.refresh();
    },
  );
  const available = options.filter((o) => !rows.some((r) => r.languageCode === o.code));

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError error={error} />
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => {
            const name = names.get(row.languageCode) ?? row.languageCode;
            return (
              <li
                key={row.languageCode}
                className="flex items-center gap-2 rounded-md border border-border p-2 pl-3"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                <label className="w-32 shrink-0 sm:w-44">
                  <span className="sr-only">
                    {t('level')} — {name}
                  </span>
                  <NativeSelect
                    value={row.proficiency}
                    onChange={(e) =>
                      setRows((all) =>
                        all.map((r) =>
                          r.languageCode === row.languageCode
                            ? { ...r, proficiency: e.target.value as Proficiency }
                            : r,
                        ),
                      )
                    }
                  >
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {t(`level_${l}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('remove', { language: name })}
                  onClick={() =>
                    setRows((all) => all.filter((r) => r.languageCode !== row.languageCode))
                  }
                >
                  <X aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid gap-2 sm:flex">
        <label className="sm:flex-1">
          <span className="sr-only">{t('add')}</span>
          <NativeSelect value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{t('language')}</option>
            {available.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={adding === ''}
          onClick={() => {
            setRows((all) => [...all, { languageCode: adding, proficiency: 'FLUENT' }]);
            setAdding('');
          }}
        >
          <Plus aria-hidden />
          {t('add')}
        </Button>
      </div>
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
