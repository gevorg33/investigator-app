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
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../../common/authz/actor.decorator';
import { ActorGuard } from '../../../common/authz/actor.guard';
import type { Actor } from '../../../common/authz/contract';
import { requestContext } from '../../../common/http/request-context';
import {
  AcceptInvitationDto,
  InviteEmployeeDto,
  SetEmployeeRolesDto,
  UpdateEmployeeDto,
} from './employees.dto';
import {
  InvitationsService,
  type AcceptedInvitation,
  type InvitationView,
} from './invitations.service';
import { MembersService, type EmployeeView } from './members.service';

const NOTHING_UPWARD =
  'The caller must hold every permission the member holds, and every permission a role they ' +
  'grant carries (403 otherwise).';

/**
 * The members of the agency the request acts in (T-085). `current` is the request's workspace,
 * never one named in the path; a member is named by their membership id.
 */
@ApiTags('agencies')
@Controller('agencies/current/members')
@UseGuards(ActorGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'This agency’s members, suspended ones included. Requires employees.read.',
  })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<EmployeeView[]> {
    return this.members.list(actor, requestContext(req));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'A member’s job title, department, and locale and time zone overrides.',
    description: `Requires employees.update. Absent is left alone; null clears. ${NOTHING_UPWARD}`,
  })
  async update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @Req() req: Request,
  ): Promise<EmployeeView> {
    return this.members.update(actor, id, dto, requestContext(req));
  }

  @Put(':id/roles')
  @ApiOperation({
    summary: 'The whole set of roles a member holds from now on.',
    description: `Requires employees.update. ${NOTHING_UPWARD} An agency always keeps an active owner (409).`,
  })
  async setRoles(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEmployeeRolesDto,
    @Req() req: Request,
  ): Promise<EmployeeView> {
    return this.members.setRoles(actor, id, dto.roles, requestContext(req));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suspend a member: refused on their next request, roles kept.',
    description: `Requires employees.suspend. Not yourself. ${NOTHING_UPWARD} Their AI sessions here are archived.`,
  })
  async suspend(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<EmployeeView> {
    return this.members.suspend(actor, id, requestContext(req));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reactivate a suspended member.',
    description: `Requires employees.suspend. ${NOTHING_UPWARD}`,
  })
  async reactivate(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<EmployeeView> {
    return this.members.reactivate(actor, id, requestContext(req));
  }

  @Post(':id/remove')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a member: refused on their next request, roles taken, row kept.',
    description: `Requires employees.remove. ${NOTHING_UPWARD} An agency always keeps an active owner (409).`,
  })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.members.remove(actor, id, requestContext(req));
  }
}

/** Invitations into the agency the request acts in (T-085). */
@ApiTags('agencies')
@Controller('agencies/current/invitations')
@UseGuards(ActorGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'This agency’s invitations, newest first. Requires employees.read.' })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<InvitationView[]> {
    return this.invitations.list(actor, requestContext(req));
  }

  @Post()
  @ApiOperation({
    summary: 'Invite an address into the agency, with one role. Requires employees.invite.',
    description:
      'Emails a single-use link, valid for 7 days. The role may grant nothing the caller does not ' +
      'hold (403). An address already a member, or already invited, is refused (409). Rate-limited ' +
      'per workspace, resends included.',
  })
  async invite(
    @CurrentActor() actor: Actor,
    @Body() dto: InviteEmployeeDto,
    @Req() req: Request,
  ): Promise<InvitationView> {
    return this.invitations.invite(actor, dto, requestContext(req));
  }

  @Post(':id/resend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a pending invitation again, with a new link; the old one stops working.',
  })
  async resend(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<InvitationView> {
    return this.invitations.resend(actor, id, requestContext(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending invitation; its link stops working.' })
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<InvitationView> {
    return this.invitations.cancel(actor, id, requestContext(req));
  }
}

/** Accepting an invitation, as the person it was sent to, from any workspace (T-085). */
@ApiTags('agencies')
@Controller('invitations')
@UseGuards(ActorGuard)
export class AcceptInvitationController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Join the agency an invitation is for.',
    description:
      'Needs an active account with the invited, confirmed address. Another account, a used, ' +
      'cancelled or expired invitation, and an unknown token all answer 404. A suspended member ' +
      'cannot rejoin this way (409).',
  })
  async accept(
    @CurrentActor() actor: Actor,
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
  ): Promise<AcceptedInvitation> {
    return this.invitations.accept(actor, dto.token, requestContext(req));
  }
}
