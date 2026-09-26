import {
  Body,
  Controller,
  Delete,
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
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './teams.dto';
import { TeamsService, type TeamView } from './teams.service';

/**
 * The teams of the agency the request acts in (T-086). `current` is the request's workspace,
 * never one named in the path; a member is named by their membership id.
 */
@ApiTags('agencies')
@Controller('agencies/current/teams')
@UseGuards(ActorGuard)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'This agency’s teams, with their members. Requires teams.read.' })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<TeamView[]> {
    return this.teams.list(actor, requestContext(req));
  }

  @Post()
  @ApiOperation({
    summary: 'Create a team. Requires teams.create.',
    description: 'A name unique in the agency, whatever the case (409 otherwise).',
  })
  async create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateTeamDto,
    @Req() req: Request,
  ): Promise<TeamView> {
    return this.teams.create(actor, dto, requestContext(req));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'One team, with its members. Requires teams.read.' })
  async read(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<TeamView> {
    return this.teams.read(actor, id, requestContext(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a team or change what it is for. Requires teams.update.' })
  async update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamDto,
    @Req() req: Request,
  ): Promise<TeamView> {
    return this.teams.update(actor, id, dto, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a team. Requires teams.delete.',
    description: 'Its members stay in the agency; only the team goes.',
  })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.teams.remove(actor, id, requestContext(req));
  }

  @Post(':id/members')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Put a member of this agency in the team. Requires teams.update.',
    description: 'A removed member cannot be (422). Already in the team: nothing changes.',
  })
  async addMember(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTeamMemberDto,
    @Req() req: Request,
  ): Promise<TeamView> {
    return this.teams.addMember(actor, id, dto.membershipId, requestContext(req));
  }

  @Delete(':id/members/:membershipId')
  @ApiOperation({ summary: 'Take a member out of the team. Requires teams.update.' })
  async removeMember(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Req() req: Request,
  ): Promise<TeamView> {
    return this.teams.removeMember(actor, id, membershipId, requestContext(req));
  }
}
