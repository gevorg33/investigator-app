import {
  Body,
  Controller,
  Get,
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
import { CurrentActor } from '../../../common/authz/actor.decorator';
import { ActorGuard } from '../../../common/authz/actor.guard';
import type { Actor } from '../../../common/authz/contract';
import { requestContext } from '../../../common/http/request-context';
import { ConfirmPlanDto, ListPlansQuery } from './ai-plans.dto';
import { AiPlansService, type PlanView } from './ai-plans.service';
import type { PlanTimeline } from './plan-timeline';

/**
 * The assistant's plans in the caller's session (T-048). A person reads, confirms or declines them
 * here; the assistant proposes them, and has no route. Every plan is the caller's own, in the
 * workspace the request is in; any other is a 404.
 */
@ApiTags('ai-plans')
@Controller('ai/sessions/:sessionId/plans')
@UseGuards(ActorGuard)
export class AiPlansController {
  constructor(private readonly plans: AiPlansService) {}

  @Get()
  @ApiOperation({
    summary: 'The session’s plans, newest first; `open=true` for those awaiting an answer',
  })
  list(
    @CurrentActor() actor: Actor,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() query: ListPlansQuery,
    @Req() req: Request,
  ): Promise<PlanView[]> {
    return this.plans.list(actor, sessionId, { open: query.open === 'true' }, requestContext(req));
  }

  @Get(':planId')
  @ApiOperation({ summary: 'One plan, its steps and how far it has run' })
  get(
    @CurrentActor() actor: Actor,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Req() req: Request,
  ): Promise<PlanView> {
    return this.plans.get(actor, sessionId, planId, requestContext(req));
  }

  @Get(':planId/timeline')
  @ApiOperation({
    summary:
      'One plan from proposal to its last step: its rows and its audit, under one correlation id',
  })
  timeline(
    @CurrentActor() actor: Actor,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Req() req: Request,
  ): Promise<PlanTimeline> {
    return this.plans.timeline(actor, sessionId, planId, requestContext(req));
  }

  @Post(':planId/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the plan as shown — once, for exactly its hash' })
  confirm(
    @CurrentActor() actor: Actor,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: ConfirmPlanDto,
    @Req() req: Request,
  ): Promise<PlanView> {
    return this.plans.confirm(actor, sessionId, planId, dto.planHash, requestContext(req));
  }

  @Post(':planId/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline a plan still awaiting an answer; nothing of it runs' })
  decline(
    @CurrentActor() actor: Actor,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Req() req: Request,
  ): Promise<PlanView> {
    return this.plans.decline(actor, sessionId, planId, requestContext(req));
  }
}
