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
import {
  ActivateRoleDto,
  UpdateCustomerProfileDto,
  UpdateInvestigatorProfileDto,
} from './profiles.dto';
import type {
  OwnCustomerProfile,
  OwnInvestigatorProfile,
  PublicCustomerProfile,
  PublicInvestigatorProfile,
} from './profile.projection';
import { ProfilesService } from './profiles.service';
import { requestContext } from '../../common/http/request-context';

/**
 * Every route resolves an Actor. There is no "get profile by id and check afterwards": the
 * owner's routes find the row by who the caller is, and the public routes return a
 * projection that cannot contain private fields regardless of who asks.
 */
@ApiTags('profiles')
@Controller('profiles')
@UseGuards(ActorGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Post('roles')
  @ApiOperation({ summary: 'Activate a role on the existing account. Never a second account.' })
  async activateRole(
    @CurrentActor() actor: Actor,
    @Body() dto: ActivateRoleDto,
    @Req() req: Request,
  ): Promise<{ profileId: string }> {
    return this.profiles.activateRole(
      actor,
      dto.role,
      requestContext(req),
      dto.acceptedDocumentIds ?? [],
    );
  }

  @Get('investigator/me')
  @ApiOperation({ summary: 'The caller’s own investigator profile, in full.' })
  async getMyInvestigator(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<OwnInvestigatorProfile> {
    return this.profiles.getMyInvestigatorProfile(actor, requestContext(req));
  }

  @Get('investigator/me/preview')
  @ApiOperation({
    summary: 'The caller’s own profile exactly as customers see it, whether published or not.',
  })
  async previewMyInvestigator(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<PublicInvestigatorProfile> {
    return this.profiles.previewMyInvestigatorProfile(actor, requestContext(req));
  }

  @Patch('investigator/me')
  @ApiOperation({ summary: 'Update the caller’s own investigator profile.' })
  async updateMyInvestigator(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateInvestigatorProfileDto,
    @Req() req: Request,
  ): Promise<OwnInvestigatorProfile> {
    return this.profiles.updateMyInvestigatorProfile(actor, dto, requestContext(req));
  }

  @Get('customer/me')
  @ApiOperation({ summary: 'The caller’s own customer profile, in full.' })
  async getMyCustomer(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<OwnCustomerProfile> {
    return this.profiles.getMyCustomerProfile(actor, requestContext(req));
  }

  @Patch('customer/me')
  @ApiOperation({ summary: 'Update the caller’s own customer profile.' })
  async updateMyCustomer(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateCustomerProfileDto,
    @Req() req: Request,
  ): Promise<OwnCustomerProfile> {
    return this.profiles.updateMyCustomerProfile(actor, dto, requestContext(req));
  }

  @Get('investigator/:id')
  @ApiOperation({ summary: 'Somebody else’s investigator profile. Published only.' })
  async getInvestigator(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PublicInvestigatorProfile> {
    return this.profiles.getPublicInvestigatorProfile(actor, id, requestContext(req));
  }

  @Get('customer/:id')
  @ApiOperation({ summary: 'Somebody else’s customer profile. Deliberately almost nothing.' })
  async getCustomer(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PublicCustomerProfile> {
    return this.profiles.getPublicCustomerProfile(actor, id, requestContext(req));
  }
}
