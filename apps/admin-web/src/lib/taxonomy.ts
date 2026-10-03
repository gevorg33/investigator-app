import { serverApi } from '@/lib/api/server';
import type { TaxonomyNode } from '@/lib/api/types';

/**
 * Every taxonomy node's name, by id — to name what a record holds by id. The English label, or the
 * slug where a node has none yet. Shared by the verification and moderation screens.
 */
export async function taxonomyLabels(): Promise<Map<string, string>> {
  const tree = (await serverApi<TaxonomyNode[]>('/taxonomy?locale=en')) ?? [];
  const out = new Map<string, string>();
  const walk = (nodes: TaxonomyNode[]) => {
    for (const n of nodes) {
      out.set(n.id, n.label ?? n.slug);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}
