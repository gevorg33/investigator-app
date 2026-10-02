import {
  Body,
  Controller,
  Get,
  Header,
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
  AgencyInvestigatorsService,
  type AgencyInvestigatorView,
} from './agency-investigators.service';
import { CreateAgencyInvestigatorDto, UpdateAgencyInvestigatorDto } from './profiles.dto';

/**
 * The investigator profiles the agency the request acts in holds (T-087). `current` is the
 * request's workspace, never one named in the path; a profile is named by its id, and one in any
 * other workspace is the same 404 as none.
 */
@ApiTags('agencies')
@Controller('agencies/current/investigators')
@UseGuards(ActorGuard)
export class AgencyInvestigatorsController {
  constructor(private readonly investigators: AgencyInvestigatorsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'This agency’s investigator profiles, with who holds each. Requires investigators.read.',
  })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<AgencyInvestigatorView[]> {
    return this.investigators.list(actor, requestContext(req));
  }

  @Post()
  @ApiOperation({
    summary: 'A profile for a member of this agency, who holds it. Requires investigators.create.',
    description:
      'The member must be active here and have taken up the INVESTIGATOR role (409 otherwise); ' +
      'one profile per person per agency (409). It starts as an unverified draft.',
  })
  async create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateAgencyInvestigatorDto,
    @Req() req: Request,
  ): Promise<AgencyInvestigatorView> {
    return this.investigators.create(actor, dto.membershipId, requestContext(req));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'One of this agency’s profiles. Requires investigators.read.' })
  async get(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AgencyInvestigatorView> {
    return this.investigators.get(actor, id, requestContext(req));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'The storefront of one of this agency’s profiles. Requires investigators.update.',
    description:
      'Absent is left alone. The holder’s legal name and whether customers see it are not ' +
      'the agency’s to write. A suspended or departed holder’s profile cannot be published ' +
      'or set to take work (409).',
  })
  async update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgencyInvestigatorDto,
    @Req() req: Request,
  ): Promise<AgencyInvestigatorView> {
    return this.investigators.update(actor, id, dto, requestContext(req));
  }
}
