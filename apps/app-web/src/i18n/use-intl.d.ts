// Typed keys everywhere: `t('nav.home')` is checked against the catalog shape (English's keys), so
// a key that does not exist is a compile error, not a blank on screen.
import type { Catalog, Locale } from '@investigator/i18n';

declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Catalog;
  }
}
