import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { AcceptAssignmentDto, DeclineAssignmentDto } from './assignments.dto';
import { AssignmentsService, type AssignmentView } from './assignments.service';

/**
 * An assignment, for the two people who are party to it.
 *
 * There is deliberately **no route that creates one**. An assignment exists because a payment
 * was authorized, and that is established by a verified provider webhook — so creation is a
 * system operation the payments module performs, not something a customer or an investigator
 * can ask for.
 */
@ApiTags('assignments')
@Controller('assignments')
@UseGuards(ActorGuard)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'One assignment, for its customer or its investigator.' })
  async get(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AssignmentView> {
    return this.assignments.getForParty(actor, id, requestContext(req));
  }

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept the assignment, committing to the scope and price.',
    description: 'Only within the acceptance window. After it closes the customer is released.',
  })
  async accept(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: AcceptAssignmentDto,
    @Req() req: Request,
  ): Promise<AssignmentView> {
    return this.assignments.accept(actor, id, requestContext(req));
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: 'Decline before accepting.',
    description:
      'A policy concern given as the reason is recorded as the ground for the staff review of ' +
      'the mission that T-050 builds — material that worried one investigator will worry the next.',
  })
  async decline(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineAssignmentDto,
    @Req() req: Request,
  ): Promise<AssignmentView> {
    return this.assignments.decline(actor, id, dto.reason, requestContext(req));
  }
}
