import type { CategoryOption } from '@/components/missions/filter-sheet';
import type { TaxonomyNode } from '@/lib/api/types';

/**
 * The taxonomy tree as one list, each node with its depth, parents before children — how every
 * category picker shows it (browse filters, the investigator's specialties, mission intake). An
 * untranslated node is named by its slug rather than left blank.
 */
export const flattenTaxonomy = (nodes: readonly TaxonomyNode[], depth = 0): CategoryOption[] =>
  nodes.flatMap((n) => [
    { id: n.id, label: n.label ?? n.slug, depth },
    ...flattenTaxonomy(n.children, depth + 1),
  ]);
