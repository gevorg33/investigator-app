import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
import { LegalHoldListQueryDto, PlaceLegalHoldDto, ReleaseLegalHoldDto } from './legal-hold.dto';
import { LegalHoldService, type LegalHoldPage, type LegalHoldView } from './legal-hold.service';

/**
 * Legal holds (T-035): data that retention must not delete. Every route requires the COMPLIANCE
 * staff scope, acting as staff. Nobody else reads a hold, including whoever the data belongs to.
 */
@ApiTags('legal-holds')
@Controller('legal-holds')
@UseGuards(ActorGuard)
export class LegalHoldController {
  constructor(private readonly holds: LegalHoldService) {}

  @Get()
  // What is preserved, and why: never kept by a browser or a proxy.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Legal holds, newest first: in force unless `status` says otherwise.',
    description:
      'COMPLIANCE staff scope. `resourceType` and `resourceId` narrow it to one resource and come together.',
  })
  async list(
    @CurrentActor() actor: Actor,
    @Query() query: LegalHoldListQueryDto,
    @Req() req: Request,
  ): Promise<LegalHoldPage> {
    return this.holds.list(actor, query, requestContext(req));
  }

  @Post()
  @ApiOperation({
    summary:
      'Place a hold on one resource: retention keeps it, and what belongs to it, until released.',
    description:
      'COMPLIANCE staff scope. A resource that does not exist is not found (404). Several holds on one resource stand independently.',
  })
  async place(
    @CurrentActor() actor: Actor,
    @Body() dto: PlaceLegalHoldDto,
    @Req() req: Request,
  ): Promise<LegalHoldView> {
    return this.holds.place(actor, dto, requestContext(req));
  }

  @Post(':id/release')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Release a hold, with a reason. Retention applies again from its next run.',
    description: 'COMPLIANCE staff scope. A hold already released is a conflict (409).',
  })
  async release(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseLegalHoldDto,
    @Req() req: Request,
  ): Promise<LegalHoldView> {
    return this.holds.release(actor, id, dto, requestContext(req));
  }
}
