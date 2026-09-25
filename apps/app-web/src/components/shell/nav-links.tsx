'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { PANEL_ID, useAssistant } from '@/components/assistant/assistant-provider';
import { cn } from '@/lib/utils';
import { DESTINATIONS, isCurrent } from './destinations';

const LAYOUT = {
  // A phone's bottom bar: five equal columns, each a full-height target with its label.
  bar: {
    list: 'grid grid-cols-5',
    link: 'relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs',
    // Not colour alone: the current item also gains a bar above it and a heavier label.
    current:
      'text-primary font-semibold before:absolute before:inset-x-5 before:top-0 before:h-1 before:rounded-full before:bg-primary',
  },
  // The sidebar from tablet up.
  rail: {
    list: 'flex flex-col gap-1',
    link: 'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-surface-sunken hover:text-text',
    current:
      'bg-primary-subtle text-primary font-semibold hover:bg-primary-subtle hover:text-primary',
  },
} as const;

/**
 * The primary destinations as links, laid out for a phone's bottom bar or a sidebar. The page
 * the reader is on is marked for assistive technology (`aria-current`) as well as visibly. The
 * assistant is a button that opens and closes it where the reader is, marked as expanded while open.
 */
export function NavLinks({ layout }: { layout: keyof typeof LAYOUT }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const assistant = useAssistant();
  const styles = LAYOUT[layout];
  return (
    <ul className={styles.list}>
      {DESTINATIONS.map(({ href, opens, label, icon: Icon }) => {
        const current = href === undefined ? assistant.open : isCurrent(pathname, href);
        const className = cn(
          'text-text-muted font-medium transition-colors duration-(--duration-fast) ease-standard',
          // A button, unlike a link, only fills its cell when told to.
          'w-full',
          styles.link,
          current && styles.current,
        );
        const inner = (
          <>
            <Icon aria-hidden className="size-5 shrink-0" />
            <span className="max-w-full truncate">{t(label)}</span>
          </>
        );
        return (
          <li key={href ?? opens}>
            {href === undefined ? (
              <button
                type="button"
                onClick={assistant.toggle}
                aria-expanded={assistant.open}
                aria-controls={assistant.open ? PANEL_ID : undefined}
                className={className}
              >
                {inner}
              </button>
            ) : (
              <Link href={href} aria-current={current ? 'page' : undefined} className={className}>
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
