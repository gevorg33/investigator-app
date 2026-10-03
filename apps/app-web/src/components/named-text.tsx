import type { Locale } from '@investigator/i18n';
import type { ReactNode } from 'react';
import type { Named } from '@/lib/taxonomy';

/**
 * A name in the language it is in, which is not always the page's (T-197, T-198): a category or tag
 * the reader's language has no label for yet is shown in English, and a screen reader is told so.
 * One with no known language is plain text.
 */
export function NamedText({ named }: { named: Named }) {
  return <span lang={named.lang}>{named.label}</span>;
}

/**
 * Names joined as the reader's language joins a list ("A, B, and C"), each still marked with its
 * own language — for a message tag filled with `t.rich`, where a joined string would lose it.
 */
export function namedList(items: readonly Named[], locale: Locale): ReactNode[] {
  let next = 0;
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })
    .formatToParts(items.map((n) => n.label))
    .map((part, i) =>
      part.type === 'element' ? (
        <span key={i} lang={items[next++]!.lang}>
          {part.value}
        </span>
      ) : (
        part.value
      ),
    );
}
