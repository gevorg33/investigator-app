import type { Actor } from '../src/common/authz/contract';
import type { ExecutionContext } from '../src/common/context/execution-context';
import { WorkspaceResolver } from '../src/common/context/workspace.resolver';

/** A plausible execution context for `actor` in its Personal workspace, for unit and HTTP specs. */
export function testContext(
  actor: Pick<Actor, 'userId'>,
  over: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    tenantId: '00000000-0000-4000-8000-00000000000a',
    tenantKind: 'PERSONAL',
    userId: actor.userId,
    membershipId: '00000000-0000-4000-8000-00000000000b',
    permissions: [],
    ...over,
  };
}

/**
 * A WorkspaceResolver for controller specs, which mock ActorService and so cannot resolve a real
 * workspace. Controllers' behaviour is not about the workspace; `workspace.resolver.spec.ts` is.
 */
export function workspaceResolverStub(actor: Pick<Actor, 'userId'>) {
  return { provide: WorkspaceResolver, useValue: { resolve: async () => testContext(actor) } };
}
