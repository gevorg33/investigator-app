import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from './contract';

/** Where the guard leaves the resolved Actor. Not part of the public shape. */
export const ACTOR_KEY = '__actor__';

export interface RequestWithActor extends Request {
  [ACTOR_KEY]?: Actor;
}

/**
 * Throws rather than returning undefined when the guard has not run.
 *
 * A handler that silently received `undefined` here would be an endpoint whose
 * authorization could be removed by deleting one decorator — and it would still answer
 * 200. Failing loudly at the first request makes that a startup-shaped mistake rather
 * than a silent hole.
 *
 * Exported separately from the decorator so it can be tested directly; Nest's param
 * decorator factory is awkward to invoke from a unit test.
 */
export function actorFromRequest(req: RequestWithActor): Actor {
  const actor = req[ACTOR_KEY];
  if (!actor) {
    throw new Error(
      'CurrentActor used on a route without ActorGuard. The guard resolves the actor; ' +
        'without it this handler would run unauthenticated.',
    );
  }
  return actor;
}

/** The authenticated caller. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor =>
  actorFromRequest(ctx.switchToHttp().getRequest<RequestWithActor>()),
);
