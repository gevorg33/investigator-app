import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
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
import { ProfilesService, type RequestContext } from './profiles.service';

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
    return this.profiles.activateRole(actor, dto.role, ctx(req));
  }

  @Get('investigator/me')
  @ApiOperation({ summary: 'The caller’s own investigator profile, in full.' })
  async getMyInvestigator(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<OwnInvestigatorProfile> {
    return this.profiles.getMyInvestigatorProfile(actor, ctx(req));
  }

  @Patch('investigator/me')
  @ApiOperation({ summary: 'Update the caller’s own investigator profile.' })
  async updateMyInvestigator(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateInvestigatorProfileDto,
    @Req() req: Request,
  ): Promise<OwnInvestigatorProfile> {
    return this.profiles.updateMyInvestigatorProfile(actor, dto, ctx(req));
  }

  @Get('customer/me')
  @ApiOperation({ summary: 'The caller’s own customer profile, in full.' })
  async getMyCustomer(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<OwnCustomerProfile> {
    return this.profiles.getMyCustomerProfile(actor, ctx(req));
  }

  @Patch('customer/me')
  @ApiOperation({ summary: 'Update the caller’s own customer profile.' })
  async updateMyCustomer(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateCustomerProfileDto,
    @Req() req: Request,
  ): Promise<OwnCustomerProfile> {
    return this.profiles.updateMyCustomerProfile(actor, dto, ctx(req));
  }

  @Get('investigator/:id')
  @ApiOperation({ summary: 'Somebody else’s investigator profile. Published only.' })
  async getInvestigator(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PublicInvestigatorProfile> {
    return this.profiles.getPublicInvestigatorProfile(actor, id, ctx(req));
  }

  @Get('customer/:id')
  @ApiOperation({ summary: 'Somebody else’s customer profile. Deliberately almost nothing.' })
  async getCustomer(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PublicCustomerProfile> {
    return this.profiles.getPublicCustomerProfile(actor, id, ctx(req));
  }
}

function ctx(req: Request): RequestContext {
  const id: unknown = (req as unknown as { id?: unknown }).id;
  return {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined,
  };
}
