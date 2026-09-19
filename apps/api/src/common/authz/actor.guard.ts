import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { CONTEXT_KEY, type RequestWithContext } from '../context/request-context-key';
import { WorkspaceResolver } from '../context/workspace.resolver';
import { requestContext } from '../http/request-context';
import { ActorService } from './actor.service';
import { ACTOR_KEY, type RequestWithActor } from './actor.decorator';

const COOKIE = 'investigator_session';

/**
 * Checks 1 and 2: resolve the caller, or reject.
 *
 * A guard is a fast rejection, not the authorization — the skill is explicit that the
 * real checks belong in the service, because a service is also reachable from a job, an
 * event handler, another module and an AI tool, none of which pass through here.
 *
 * So this does the smallest useful thing: turn a cookie into an Actor and attach it.
 * Everything about what that Actor may do is decided further down.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly actors: ActorService,
    private readonly workspaces: WorkspaceResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const token = String(req.cookies?.[COOKIE] ?? '');

    // The role the client wishes to act as. A header, not a stored preference: switching
    // workspaces must not need a new sign-in, and must not outlive the request either.
    // ActorService intersects it with the roles actually held, so this can only narrow.
    const requested = req.get('x-active-role');

    const actor = await this.actors.fromRefreshToken(token, requested);
    req[ACTOR_KEY] = actor;

    // Check 0 (T-075): the workspace, from `X-Workspace` intersected with the caller's
    // memberships. ContextInterceptor then runs the handler inside it.
    const { correlationId, ip } = requestContext(req);
    (req as RequestWithContext)[CONTEXT_KEY] = await this.workspaces.resolve(
      actor,
      req.get('x-workspace'),
      { correlationId, ipAddress: ip },
    );
    return true;
  }
}
