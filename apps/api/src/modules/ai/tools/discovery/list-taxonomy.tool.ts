import { Injectable } from '@nestjs/common';
import type { Actor, Role } from '../../../../common/authz/contract';
import { TaxonomyService, type TaxonomyTreeNode } from '../../../taxonomy/taxonomy.service';
import type { AssistantTool } from '../assistant-tool';
import {
  listTaxonomyInput,
  listTaxonomyOutput,
  type ListTaxonomyInput,
  type ListTaxonomyOutput,
} from './discovery.schemas';

/**
 * `listTaxonomy` — the shared taxonomy's ACTIVE nodes, labelled, for turning a request into
 * specialty filters (ADR-0007, T-018).
 *
 * Read from the database every time: the categories a request can be matched to are data staff
 * curate, never a list written into a prompt (non-negotiable 7).
 */
@Injectable()
export class ListTaxonomyTool implements AssistantTool<ListTaxonomyInput, ListTaxonomyOutput> {
  readonly name = 'listTaxonomy';
  readonly description =
    'The specialties investigators declare and missions are filed under, as a flat list of ' +
    'labelled nodes with their parents.';
  readonly requiredRoles: readonly Role[] = ['CUSTOMER', 'INVESTIGATOR', 'STAFF'];
  readonly resourceScope = 'public_projection' as const;
  readonly operation = 'read' as const;
  readonly confirmation = 'none' as const;
  readonly input = listTaxonomyInput;
  readonly output = listTaxonomyOutput;
  readonly auditEvent = 'ai.tool.list_taxonomy';
  readonly rateLimit = { perMinute: 30 };

  constructor(private readonly taxonomy: TaxonomyService) {}

  auditArguments(input: ListTaxonomyInput): string {
    return `locale=${input.locale ?? 'en'}`;
  }

  async execute(_actor: Actor, input: ListTaxonomyInput): Promise<ListTaxonomyOutput> {
    const flat = (
      nodes: TaxonomyTreeNode[],
      parentId: string | null,
    ): ListTaxonomyOutput['nodes'] =>
      nodes.flatMap((n) => [
        { id: n.id, slug: n.slug, parentId, label: n.label, description: n.description },
        ...flat(n.children, n.id),
      ]);
    return { nodes: flat(await this.taxonomy.tree(input.locale), null) };
  }
}
