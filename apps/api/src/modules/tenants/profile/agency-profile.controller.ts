import {
  Body,
  Controller,
  Get,
  Header,
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
import { CurrentActor } from '../../../common/authz/actor.decorator';
import { ActorGuard } from '../../../common/authz/actor.guard';
import type { Actor } from '../../../common/authz/contract';
import { requestContext } from '../../../common/http/request-context';
import { ProfileVersionDto, UpdateAgencyProfileDto } from './agency-profile.dto';
import {
  AgencyProfileService,
  type OwnAgencyProfile,
  type PublicAgencyProfile,
} from './agency-profile.service';

/**
 * An agency's public profile (T-084). `current` is the agency the request acts in (`X-Workspace`),
 * never one named in the path; the public projection is by id. Every response may carry signed
 * image links, so none is cached.
 */
@ApiTags('agencies')
@Controller('agencies')
@UseGuards(ActorGuard)
export class AgencyProfileController {
  constructor(private readonly profiles: AgencyProfileService) {}

  // Declared before `:id/profile`, which would otherwise take "current" as an id.
  @Get('current/profile')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'This agency’s profile, published or not. Requires company.read.' })
  async readOwn(@CurrentActor() actor: Actor, @Req() req: Request): Promise<OwnAgencyProfile> {
    return this.profiles.readOwn(actor, requestContext(req));
  }

  @Patch('current/profile')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Change this agency’s profile. Requires company.update and the version read.',
  })
  async update(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateAgencyProfileDto,
    @Req() req: Request,
  ): Promise<OwnAgencyProfile> {
    return this.profiles.update(actor, dto, requestContext(req));
  }

  @Post('current/profile/publish')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Publish this agency’s profile. Needs a finished (ACTIVE) agency and a headline.',
  })
  async publish(
    @CurrentActor() actor: Actor,
    @Body() dto: ProfileVersionDto,
    @Req() req: Request,
  ): Promise<OwnAgencyProfile> {
    return this.profiles.publish(actor, dto.version, requestContext(req));
  }

  @Post('current/profile/unpublish')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Take this agency’s profile back to a draft.' })
  async unpublish(
    @CurrentActor() actor: Actor,
    @Body() dto: ProfileVersionDto,
    @Req() req: Request,
  ): Promise<OwnAgencyProfile> {
    return this.profiles.unpublish(actor, dto.version, requestContext(req));
  }

  @Get(':id/profile')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'A published agency’s public profile.',
    description:
      'Only the projection: name, headline, about, country, logo and cover. Unpublished, not ' +
      'an agency, not active or unknown all answer the same 404.',
  })
  async readPublished(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PublicAgencyProfile> {
    return this.profiles.readPublished(actor, id, requestContext(req));
  }
}
