import type { Locale } from '../locales.js';
import type { Catalog } from './catalog.js';
import { en } from './en.js';
import { hy } from './hy.js';
import { ru } from './ru.js';

export type { Catalog };
export { en };

/** Every locale's catalog. English is the source, and the fallback for a message that fails. */
export const catalogs: Readonly<Record<Locale, Catalog>> = { en, ru, hy };
