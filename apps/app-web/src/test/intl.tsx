import { catalogs, type Locale } from '@investigator/i18n';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CLIENT_NAMESPACES } from '@/app/layout';
import { I18nProvider } from '@/i18n/provider';

/**
 * Renders inside the same translations the root layout gives client components — the namespaces
 * the browser actually receives, so a client component using any other key fails here too.
 */
export function renderIntl(ui: ReactNode, locale: Locale = 'en') {
  const messages = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, catalogs[locale][ns]]));
  // A wrapper, not a parent: `rerender` keeps the provider.
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider locale={locale} messages={messages}>
        {children}
      </I18nProvider>
    ),
  });
}
