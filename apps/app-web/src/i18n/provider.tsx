'use client';

import type { Catalog, Locale } from '@investigator/i18n';
import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { intlConfig } from './translator';

/**
 * Translations for client components. Receives only the namespaces they use (`CLIENT_NAMESPACES`
 * in the root layout), not the whole catalog, so the browser downloads what it renders.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Partial<Catalog>;
  children: ReactNode;
}) {
  return (
    <IntlProvider {...intlConfig(locale)} messages={messages}>
      {children}
    </IntlProvider>
  );
}
