import { colors } from '@investigator/ui-tokens';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LOCALE, t } from '@/i18n/messages';
import './globals.css';

export const metadata: Metadata = {
  title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
  // The application is never indexed (ADR-0002). next.config.ts sends the same as a header.
  robots: { index: false, follow: false },
};

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={LOCALE}>
      <body>{children}</body>
    </html>
  );
}
