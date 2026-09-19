import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { WorkspacesService, type WorkspaceView } from './workspaces.service';

/**
 * The caller's workspaces (T-075). Which workspace a request acts in is the `X-Workspace` header,
 * intersected with these; nothing here takes a workspace from a body.
 */
@ApiTags('workspaces')
@Controller('workspaces')
@UseGuards(ActorGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'The workspaces the caller can work in, marking the current one.' })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<WorkspaceView[]> {
    return this.workspaces.list(actor, requestContext(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Make a workspace the session default, for requests that send no X-Workspace.',
  })
  async activate(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.workspaces.activate(actor, id, requestContext(req));
  }
}
