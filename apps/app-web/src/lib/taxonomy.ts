import type { TaxonomyNode } from '@/lib/api/types';

/**
 * A name as the API gave it, and the language it is in where that is known (T-197): English where
 * the reader's has no label yet, so a screen reader can be told — `lang` on whatever shows it.
 */
export interface Named {
  label: string;
  lang?: string;
}

/** A taxonomy node as a picker shows it: indented under its parent. */
export interface CategoryOption extends Named {
  id: string;
  depth: number;
}

/**
 * The tree as one list, each node with its depth, parents before children. A node with no label
 * in the reader's language is named by its slug rather than left out — in no language in particular.
 */
export const categoryOptions = (nodes: readonly TaxonomyNode[], depth = 0): CategoryOption[] =>
  nodes.flatMap((n) => [
    {
      id: n.id,
      depth,
      ...(n.label === null || n.labelLocale === null
        ? { label: n.label ?? n.slug }
        : { label: n.label, lang: n.labelLocale }),
    },
    ...categoryOptions(n.children, depth + 1),
  ]);
