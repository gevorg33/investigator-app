import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContextInterceptor } from '../context/context.interceptor';
import { WorkspaceResolver } from '../context/workspace.resolver';
import { SessionService } from '../../modules/auth/session.service';
import { TokenService } from '../../modules/auth/token.service';
import { ActorGuard } from './actor.guard';
import { ActorService } from './actor.service';
import { AuthzService } from './authz.service';

/**
 * Global, and deliberately depends on no feature module.
 *
 * Authorization sits underneath the modules that use it. Importing AuthModule here would
 * make the two mutually dependent — Nest refuses to build that graph, and the forwardRef
 * that would paper over it hides a direction the architecture should state outright.
 *
 * So this declares its own TokenService and SessionService. Both are stateless: one hashes
 * and compares, the other answers questions about a row it is handed. A second instance
 * holds nothing the first one has, which is what makes duplicating them safe rather than
 * merely convenient.
 */
@Global()
@Module({
  providers: [
    TokenService,
    SessionService,
    AuthzService,
    ActorService,
    ActorGuard,
    WorkspaceResolver,
    // Global: every route whose guard resolved a workspace runs its handler inside it (T-075).
    { provide: APP_INTERCEPTOR, useClass: ContextInterceptor },
  ],
  exports: [AuthzService, ActorService, ActorGuard, WorkspaceResolver],
})
export class AuthzModule {}
