import type { Locale } from '@investigator/i18n';
import type { CategoryOption } from '@/lib/taxonomy';
import { serverApi } from '@/lib/api/server';
import type { TaxonomyNode } from '@/lib/api/types';
import { countryOptions, languageOptions, type CodeOption } from '@/lib/codes';
import { categoryOptions } from '@/lib/taxonomy';

/** What the intake offers to choose from, named in the reader's language on the server. */
export interface IntakeOptions {
  categories: CategoryOption[];
  countries: CodeOption[];
  languages: CodeOption[];
  currencies: string[];
}

/**
 * The choices, read once on the server so the page hydrates with the names it rendered: the
 * taxonomy as the API serves it (T-053), and countries, languages and currencies from `Intl`.
 */
export async function intakeOptions(locale: Locale): Promise<IntakeOptions> {
  const taxonomy = await serverApi<TaxonomyNode[]>(`/taxonomy?locale=${locale}`);
  return {
    categories: categoryOptions(taxonomy ?? []),
    countries: countryOptions(locale),
    languages: languageOptions(locale),
    currencies: Intl.supportedValuesOf('currency'),
  };
}
