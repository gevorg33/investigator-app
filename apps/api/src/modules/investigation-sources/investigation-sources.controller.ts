import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { CreateSourceDto, UpdateSourceDto } from './investigation-sources.dto';
import { InvestigationSourcesService, type SourceView } from './investigation-sources.service';

/** Sources within one assignment (T-031). Nothing here reaches another assignment's. */
@ApiTags('investigation-sources')
@Controller('assignments/:assignmentId/sources')
@UseGuards(ActorGuard)
export class InvestigationSourcesController {
  constructor(private readonly sources: InvestigationSourcesService) {}

  @Get()
  @ApiOperation({
    summary: 'The assignment’s sources',
    description:
      'All live sources for the assignment’s investigator; only the shared ones for its customer. ' +
      'Anyone else gets 404.',
  })
  list(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ): Promise<SourceView[]> {
    return this.sources.list(actor, assignmentId, requestContext(req));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Record a source (the assignment’s investigator, while the work is live)',
    description:
      'Private unless `shared` is set. A reliability other than UNKNOWN needs its rationale. ' +
      'The locator is a record of where the investigator looked; the server never fetches it.',
  })
  create(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CreateSourceDto,
    @Req() req: Request,
  ): Promise<SourceView> {
    return this.sources.create(actor, assignmentId, dto, requestContext(req));
  }

  @Patch(':sourceId')
  @ApiOperation({ summary: 'Correct a source, or share it with the customer' })
  update(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Body() dto: UpdateSourceDto,
    @Req() req: Request,
  ): Promise<SourceView> {
    return this.sources.update(actor, assignmentId, sourceId, dto, requestContext(req));
  }

  @Post(':sourceId/withdraw')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Withdraw a source',
    description: 'Out of use and out of the customer’s sight, and kept. A withdrawal is final.',
  })
  async withdraw(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.sources.withdraw(actor, assignmentId, sourceId, requestContext(req));
  }
}
