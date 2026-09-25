import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { BrowseMissionsDto, SaveMissionSearchDto } from './mission-browse.dto';
import {
  MissionBrowseService,
  type MissionBrowsePage,
  type SavedMissionSearch,
} from './mission-browse.service';

/**
 * Investigators browsing the missions they could quote on (T-054).
 *
 * `POST` for the browse itself, like discovery: the filters are a structured object with arrays,
 * and a personalised, eligibility-filtered result is not something a cache could serve anyway.
 */
@ApiTags('search')
@Controller('search/missions')
@UseGuards(ActorGuard)
export class MissionBrowseController {
  constructor(private readonly browse: MissionBrowseService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Browse the published missions this investigator could quote on.',
    description:
      'Eligibility — a published mission, not the caller’s own, and a caller who may quote — is ' +
      'applied in SQL with the filters, which only narrow it. Free text orders and never filters. ' +
      'Results carry nothing about the customer.',
  })
  async missions(
    @CurrentActor() actor: Actor,
    @Body() dto: BrowseMissionsDto,
    @Req() req: Request,
  ): Promise<MissionBrowsePage> {
    return this.browse.browse(actor, dto, requestContext(req));
  }

  @Get('saved')
  @ApiOperation({ summary: 'This investigator’s saved searches, newest first.' })
  async saved(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<{ items: SavedMissionSearch[] }> {
    return { items: await this.browse.listSaved(actor, requestContext(req)) };
  }

  @Post('saved')
  @ApiOperation({ summary: 'Save a browse under a name. At most 20; names are unique.' })
  async save(
    @CurrentActor() actor: Actor,
    @Body() dto: SaveMissionSearchDto,
    @Req() req: Request,
  ): Promise<SavedMissionSearch> {
    return this.browse.save(actor, dto, requestContext(req));
  }

  @Delete('saved/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one of this investigator’s saved searches.' })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.browse.removeSaved(actor, id, requestContext(req));
  }
}
