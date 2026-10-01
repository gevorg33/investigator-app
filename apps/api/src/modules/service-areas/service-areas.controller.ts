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
import { CreateServiceAreaDto } from './service-areas.dto';
import { ServiceAreasService, type OwnServiceArea } from './service-areas.service';

/**
 * The owner's own areas only. There is deliberately no route that reads someone else's areas,
 * and no search route here: coverage is composed into discovery (T-011), which returns
 * distances, never geometry. Coordinates travel in request bodies, never in a URL.
 */
@ApiTags('service-areas')
@Controller('service-areas')
@UseGuards(ActorGuard)
export class ServiceAreasController {
  constructor(private readonly areas: ServiceAreasService) {}

  @Get('me')
  @ApiOperation({ summary: 'The caller’s own service areas.' })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<OwnServiceArea[]> {
    return this.areas.listMine(actor, requestContext(req));
  }

  @Post('me')
  @ApiOperation({ summary: 'Add a service area: a centre with a radius, or a drawn boundary.' })
  async create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateServiceAreaDto,
    @Req() req: Request,
  ): Promise<OwnServiceArea> {
    return this.areas.createMine(actor, dto, requestContext(req));
  }

  @Delete('me/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove one of the caller’s own service areas.' })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.areas.deleteMine(actor, id, requestContext(req));
  }
}

/**
 * The areas of a profile the agency the request acts in holds (T-087). The same shapes and limits
 * as the holder's own; the profile is named by id, and one in any other workspace is a 404.
 */
@ApiTags('agencies')
@Controller('agencies/current/investigators/:profileId/service-areas')
@UseGuards(ActorGuard)
export class AgencyServiceAreasController {
  constructor(private readonly areas: ServiceAreasService) {}

  @Get()
  @ApiOperation({ summary: 'A held profile’s service areas. Requires investigators.read.' })
  async list(
    @CurrentActor() actor: Actor,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Req() req: Request,
  ): Promise<OwnServiceArea[]> {
    return this.areas.listForAgency(actor, profileId, requestContext(req));
  }

  @Post()
  @ApiOperation({ summary: 'Add a service area to a held profile. Requires investigators.update.' })
  async create(
    @CurrentActor() actor: Actor,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: CreateServiceAreaDto,
    @Req() req: Request,
  ): Promise<OwnServiceArea> {
    return this.areas.createForAgency(actor, profileId, dto, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a held profile’s service area. Requires investigators.update.' })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.areas.deleteForAgency(actor, profileId, id, requestContext(req));
  }
}
