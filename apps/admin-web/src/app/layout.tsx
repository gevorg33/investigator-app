import { colors } from '@investigator/ui-tokens';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LOCALE, t } from '@/i18n/messages';
import './globals.css';

export const metadata: Metadata = {
  title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
  // The staff console is never indexed (ADR-0002). next.config.ts sends the same as a header.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colors.light.surface },
    { media: '(prefers-color-scheme: dark)', color: colors.dark.surface },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={LOCALE}>
      <body>{children}</body>
    </html>
  );
}
