import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
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
  constructor(private readonly actors: ActorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const token = String(req.cookies?.[COOKIE] ?? '');

    // The role the client wishes to act as. A header, not a stored preference: switching
    // workspaces must not need a new sign-in, and must not outlive the request either.
    // ActorService intersects it with the roles actually held, so this can only narrow.
    const requested = req.get('x-active-role');

    req[ACTOR_KEY] = await this.actors.fromRefreshToken(token, requested);
    return true;
  }
}
