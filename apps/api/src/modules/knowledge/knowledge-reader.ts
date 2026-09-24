import type { Actor, Role } from '../../common/authz/contract';
import { currentContext, type ExecutionContext } from '../../common/context/execution-context';
import type { Audience, Visibility } from './knowledge-source';

/**
 * What one caller may retrieve from the knowledge base (T-017).
 *
 * Row-level security admits every platform document to every context, by design (T-016): the
 * knowledge tables hold guidance for every audience, and this is the rule that keeps each audience
 * to its own. So it is applied twice — in the retrieval query, and again to every row loaded by id
 * before anything reaches a prompt (`permission-aware-rag`).
 */
export interface KnowledgeReader {
  readonly audiences: readonly Audience[];
  readonly visibilities: readonly Visibility[];
}

/** Which audience a platform role reads as. */
const AUDIENCE_OF: Readonly<Record<Role, Audience>> = {
  CUSTOMER: 'customer',
  INVESTIGATOR: 'investigator',
  STAFF: 'staff',
};

/**
 * Public guidance for everyone; each role's own guidance for that role; agency guidance inside an
 * agency workspace. The roles are the ones in force: someone who has narrowed themselves to one
 * role (`activeRole`) reads as that role alone, exactly as they act as it.
 *
 * `authenticated` because every caller here is signed in. `staff` only for STAFF. `participant`
 * never: it means "the parties to a mission", and a knowledge question names no mission to be a
 * party to — so no document marked that way is served until a question can carry one.
 */
export function knowledgeReader(
  actor: Pick<Actor, 'roles' | 'activeRole'>,
  context: Pick<ExecutionContext, 'tenantKind'>,
): KnowledgeReader {
  const roles = actor.activeRole === undefined ? actor.roles : [actor.activeRole];
  const audiences = new Set<Audience>(['public', ...roles.map((r) => AUDIENCE_OF[r])]);
  if (context.tenantKind === 'AGENCY') audiences.add('agency');
  const visibilities: Visibility[] = ['public', 'authenticated'];
  if (roles.includes('STAFF')) visibilities.push('staff');
  return { audiences: [...audiences], visibilities };
}

/** One loaded row, as the gate after the query sees it. */
export interface ReadableRow {
  status: string;
  audience: Audience;
  visibility: Visibility;
  tenantId: string | null;
}

/**
 * The gate every loaded row passes before it can reach a prompt. A current document, an audience
 * and a visibility this reader holds, and the platform's or this workspace's own — the workspace
 * read from the execution context, never passed in (ADR-0011). Outside any workspace, only the
 * platform's documents pass.
 */
export const mayRead = (reader: KnowledgeReader, row: ReadableRow): boolean =>
  row.status === 'current' &&
  reader.audiences.includes(row.audience) &&
  reader.visibilities.includes(row.visibility) &&
  (row.tenantId === null || row.tenantId === currentContext()?.tenantId);
