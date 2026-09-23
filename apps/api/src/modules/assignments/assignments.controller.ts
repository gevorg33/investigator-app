import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { AcceptAssignmentDto, DeclineAssignmentDto, HaltAssignmentDto } from './assignments.dto';
import { AssignmentsService, type AssignmentView } from './assignments.service';
import { PolicyRefusalService } from './policy-refusal.service';

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
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly refusal: PolicyRefusalService,
  ) {}

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
    summary: 'Decline before accepting. The customer is released and refunded in full.',
    description:
      'With `reasonCode: POLICY_CONCERN`, `reason` is the ground (at least 20 characters) and opens ' +
      'a staff review of the mission; it is never shown to the customer (T-050).',
  })
  async decline(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineAssignmentDto,
    @Req() req: Request,
  ): Promise<AssignmentView> {
    return this.refusal.decline(
      actor,
      id,
      { reasonCode: dto.reasonCode, reason: dto.reason },
      requestContext(req),
    );
  }

  @Post(':id/halt')
  @ApiOperation({
    summary: 'Stop accepted work on lawful grounds, at any point.',
    description:
      'The assignment is suspended, the money held, and moderation staff review the ground, which ' +
      'the customer does not see. Staff resume the work or cancel it (T-050).',
  })
  async halt(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HaltAssignmentDto,
    @Req() req: Request,
  ): Promise<AssignmentView> {
    return this.refusal.halt(actor, id, dto.ground, requestContext(req));
  }
}
