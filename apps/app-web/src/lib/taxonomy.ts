import type { TaxonomyNode } from '@/lib/api/types';

/** A taxonomy node as a picker shows it: indented under its parent. */
export interface CategoryOption {
  id: string;
  label: string;
  depth: number;
}

/**
 * The tree as one list, each node with its depth, parents before children. A node with no label
 * in the reader's language is named by its slug rather than left out.
 */
export const categoryOptions = (nodes: readonly TaxonomyNode[], depth = 0): CategoryOption[] =>
  nodes.flatMap((n) => [
    { id: n.id, label: n.label ?? n.slug, depth },
    ...categoryOptions(n.children, depth + 1),
  ]);
