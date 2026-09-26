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
