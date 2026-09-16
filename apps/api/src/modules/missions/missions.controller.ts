import {
  Body,
  Controller,
  Get,
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
import {
  CancelMissionDto,
  SaveMissionDraftDto,
  SubmitMissionDto,
  UpdateMissionDraftDto,
} from './missions.dto';
import { MissionsService, type OwnMission } from './missions.service';

/**
 * The customer's own missions.
 *
 * Every route here is scoped to the caller: there is no route that reads another customer's
 * mission, and none that publishes one. Investigators reach published missions through
 * discovery (T-054) and moderators through the review queue (T-051).
 */
@ApiTags('missions')
@Controller('missions')
@UseGuards(ActorGuard)
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get('me')
  @ApiOperation({ summary: 'The caller’s own missions, newest first.' })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<OwnMission[]> {
    return this.missions.listMine(actor, requestContext(req));
  }

  @Post('me')
  @ApiOperation({
    summary: 'Start a mission draft. Drafts are private and can be saved incomplete.',
  })
  async create(
    @CurrentActor() actor: Actor,
    @Body() dto: SaveMissionDraftDto,
    @Req() req: Request,
  ): Promise<OwnMission> {
    return this.missions.createDraft(actor, dto, requestContext(req));
  }

  @Get('me/:id')
  @ApiOperation({ summary: 'One of the caller’s own missions.' })
  async get(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<OwnMission> {
    return this.missions.getMine(actor, id, requestContext(req));
  }

  @Patch('me/:id')
  @ApiOperation({ summary: 'Edit a draft. Only drafts may be edited, and the version must match.' })
  async update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMissionDraftDto,
    @Req() req: Request,
  ): Promise<OwnMission> {
    return this.missions.updateDraft(actor, id, dto, requestContext(req));
  }

  @Post('me/:id/submit')
  @ApiOperation({
    summary: 'Submit a mission for review. Requires the lawful-purpose confirmation.',
    description:
      'Screening runs immediately and the mission is held for a moderator. Nothing here publishes it: ' +
      'no mission reaches investigators without a moderator publishing it.',
  })
  async submit(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitMissionDto,
    @Req() req: Request,
  ): Promise<OwnMission> {
    return this.missions.submit(actor, id, dto, requestContext(req));
  }

  @Post('me/:id/cancel')
  @ApiOperation({ summary: 'Cancel a mission, while cancelling is still the customer’s to do.' })
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelMissionDto,
    @Req() req: Request,
  ): Promise<OwnMission> {
    return this.missions.cancel(actor, id, dto, requestContext(req));
  }
}
