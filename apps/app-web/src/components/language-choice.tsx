import { LOCALES, localeName } from '@investigator/i18n';
import { Check } from 'lucide-react';
import { chooseLocale } from '@/app/(workspace)/account/actions';
import { getLocale, getT } from '@/i18n/server';
import { cn } from '@/lib/utils';

/**
 * The reader's language. One submit button per locale, so it works before any JavaScript loads.
 * Each is named in its own language — the reader who cannot read the current one can still find
 * theirs — and carries `lang`, so a screen reader pronounces it correctly. The one in use is
 * pressed, and marked with a check as well as colour.
 */
export async function LanguageChoice() {
  const [t, { locale }] = await Promise.all([getT(), getLocale()]);
  return (
    <section
      aria-labelledby="language-title"
      className="mt-6 rounded-lg border border-border bg-surface-raised p-6"
    >
      <h2 id="language-title" className="text-lg font-semibold">
        {t('account.language.title')}
      </h2>
      <p className="mt-1 text-sm text-text-muted">{t('account.language.body')}</p>
      <form action={chooseLocale} className="mt-4 flex flex-col gap-2 sm:flex-row">
        {LOCALES.map((option) => {
          const current = option === locale;
          return (
            <button
              key={option}
              type="submit"
              name="locale"
              value={option}
              lang={option}
              aria-pressed={current}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border-control px-4 text-base transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-sunken',
                current &&
                  'border-primary bg-primary-subtle font-semibold text-primary hover:bg-primary-subtle',
              )}
            >
              {current && <Check aria-hidden className="size-4" />}
              {localeName(option)}
            </button>
          );
        })}
      </form>
    </section>
  );
}
