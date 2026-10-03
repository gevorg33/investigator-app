import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import {
  DecideModerationDto,
  LatencyQueryDto,
  ModerationQueueQueryDto,
} from './mission-moderation.dto';
import {
  MissionModerationService,
  type LatencyReport,
  type ModerationDecisionView,
  type ModerationQueuePage,
  type ModerationReviewView,
} from './mission-moderation.service';

/**
 * The moderation queue (T-051): missions under review, one mission at a time, and the three
 * decisions. Every route requires the MODERATION staff scope, acting as staff; the admin console is
 * the only client. Nothing here lists or reads a mission for anyone else.
 */
@ApiTags('moderation')
@Controller('moderation/missions')
@UseGuards(ActorGuard)
export class MissionModerationController {
  constructor(private readonly moderation: MissionModerationService) {}

  @Get()
  // A list of other people's missions: never kept by a browser or a proxy.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Missions under review: most sensitive risk band first, then longest waiting.',
    description: 'MODERATION staff scope.',
  })
  async queue(
    @CurrentActor() actor: Actor,
    @Query() query: ModerationQueueQueryDto,
    @Req() req: Request,
  ): Promise<ModerationQueuePage> {
    return this.moderation.queue(actor, query, requestContext(req));
  }

  // Before `:id`, so "latency" is never read as a mission id.
  @Get('latency')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Review latency per category and risk band: decisions, median, 90th percentile and longest wait, and outcomes.',
    description:
      'MODERATION staff scope. Aggregates only — no mission, customer or moderator. `days` is 30, 90 (default) or 365.',
  })
  async latency(
    @CurrentActor() actor: Actor,
    @Query() query: LatencyQueryDto,
    @Req() req: Request,
  ): Promise<LatencyReport> {
    return this.moderation.latency(actor, query, requestContext(req));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'One submitted mission: the brief, its screening, any AI classification (input only), and earlier decisions.',
    description: 'MODERATION staff scope. A draft that was never submitted is not found.',
  })
  async getForReview(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ModerationReviewView> {
    return this.moderation.getForReview(actor, id, requestContext(req));
  }

  @Post(':id/decision')
  @ApiOperation({
    summary: 'Publish, reject, or return for changes, with a reason.',
    description:
      'MODERATION staff scope. The reason on a rejection or a return is shown to the customer as written; the internal note never is. ' +
      'A moderator party to the mission is refused (403); a mission no longer under review, or at another version, is a conflict (409).',
  })
  async decide(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideModerationDto,
    @Req() req: Request,
  ): Promise<ModerationDecisionView> {
    return this.moderation.decide(actor, id, dto, requestContext(req));
  }
}
