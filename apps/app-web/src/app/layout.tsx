import { catalogs, type Catalog } from '@investigator/i18n';
import { colors } from '@investigator/ui-tokens';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n/provider';
import { getLocale, getT } from '@/i18n/server';
import './globals.css';

/** The namespaces client components translate. Everything else is rendered on the server. */
export const CLIENT_NAMESPACES = [
  'nav',
  'auth',
  'account',
  'legal',
  'error',
] as const satisfies ReadonlyArray<keyof Catalog>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
    // The application is never indexed (ADR-0002). next.config.ts sends the same as a header.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the layout reach under a notch and home indicator, and pad itself with the safe-area
  // insets rather than leave a letterbox.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colors.light.surface },
    { media: '(prefers-color-scheme: dark)', color: colors.dark.surface },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getLocale();
  const messages = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, catalogs[locale][ns]]));
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
