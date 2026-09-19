import type { Request } from 'express';
import type { ExecutionContext } from './execution-context';

/** Where ActorGuard leaves the resolved execution context for ContextInterceptor. */
export const CONTEXT_KEY = '__execution_context__';

export interface RequestWithContext extends Request {
  [CONTEXT_KEY]?: ExecutionContext;
}
